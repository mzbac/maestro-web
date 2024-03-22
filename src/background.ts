import Anthropic from '@anthropic-ai/sdk';
import * as marked from 'marked';

let anthropic: Anthropic;

chrome.webRequest.onHeadersReceived.addListener(
    function (details) {
        if (details.responseHeaders) {
            details.responseHeaders.push({
                name: "Access-Control-Allow-Origin",
                value: "*"
            });
        }
        return { responseHeaders: details.responseHeaders };

    },
    { urls: ["<all_urls>"] },
    ["blocking", "responseHeaders"]
);


async function opusOrchestrator(objective: string, previousResults: string[] | null = null): Promise<string | null> {
    try {
        chrome.runtime.sendMessage({
            type: 'progressUpdate',
            content: marked.parse(`Calling Opus for your objective: ${objective}`)
        });
        const previousResultsText = previousResults ? previousResults.join('\n') : 'None';
        const messages = [
            {
                role: 'user' as const,
                content: [
                    { type: "text" as const, text: `Based on the following objective and the previous sub-task results (if any), please break down the objective into the next sub-task, and create a concise and detailed prompt for a subagent so it can execute that task, please assess if the objective has been fully achieved. If the previous sub-task results comprehensively address all aspects of the objective, include the phrase 'The task is complete:' at the beginning of your response. If the objective is not yet fully achieved, break it down into the next sub-task and create a concise and detailed prompt for a subagent to execute that task.:\n\nObjective: ${objective}\n\nPrevious sub-task results:\n${previousResultsText}` }
                ]
            }
        ];
        const opusResponse = await anthropic.messages.create({
            model: "claude-3-opus-20240229",
            max_tokens: 2048,
            messages: messages,
        });

        const responseText = opusResponse.content[0].text;
        chrome.runtime.sendMessage({
            type: 'progressUpdate',
            content: marked.parse(`Opus Orchestrator: Sending task to Haiku 👇 ${responseText}`)
        });
        return responseText;
    } catch (e) {
        console.log(`[bold red]Error in opusOrchestrator:[/bold red] ${e}`);
        return null;
    }
}

async function haikuSubAgent(prompt: string, previousHaikuTasks: string[] | null = null): Promise<string | null> {
    try {
        if (previousHaikuTasks === null) {
            previousHaikuTasks = [];
        }

        const systemMessage = "Previous Haiku tasks:\n" + previousHaikuTasks.join("\n");

        const messages = [
            {
                role: "user" as const,
                content: [
                    { type: "text" as const, text: prompt }
                ]
            }
        ];

        const haikuResponse = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 2048,
            messages: messages,
            system: systemMessage
        });

        const responseText = haikuResponse.content[0].text;
        chrome.runtime.sendMessage({
            type: 'progressUpdate',
            content: marked.parse(`Haiku Sub-agent Result:\n${responseText}\nTask completed, sending result to Opus 👇`)
        });
        return responseText;
    } catch (e) {
        console.error(`Error in haikuSubAgent: ${e}`);
        return null;
    }
}

async function opusRefine(objective: string, subTaskResults: string[]): Promise<string | null> {
    try {
        chrome.runtime.sendMessage({
            type: 'progressUpdate',
            content: marked.parse(`Calling Opus to provide the refined final output for your objective:`)
        });
        const messages = [{
            role: 'user' as const,
            content: [{
                type: 'text' as const,
                text: `Objective: ${objective}\n\nSub-task results:\n${subTaskResults.join('\n')}\n\nPlease review and refine the sub-task results into a cohesive final output. Add any missing information or details as needed. When working on code projects make sure to include the code implementation by file.`
            }]
        }];

        const opusResponse = await anthropic.messages.create({
            model: 'claude-3-opus-20240229',
            max_tokens: 4096,
            messages: messages
        });

        const responseText = opusResponse.content[0].text;
        chrome.runtime.sendMessage({
            type: 'progressUpdate',
            content: marked.parse(`Final Output: ${responseText}`)
        });
        return responseText;
    } catch (e) {
        console.error(`Error in opusRefine: ${e}`);
        return null;
    }
}

async function processTask(objective: string, apiKey: string) {
    try {
        const storedApiKey: string = await new Promise((resolve, reject) => {
            chrome.storage.local.get('apiKey', (data) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError.message);
                } else {
                    resolve(data.apiKey);
                }
            });
        });
        const apiKeyToUse = apiKey || storedApiKey;

        if (!apiKey) {
            chrome.storage.local.set({ apiKey: apiKeyToUse }, () => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                } else {
                    console.log('API Key saved successfully.');
                }
            });
        }

        anthropic = new Anthropic({
            apiKey: apiKeyToUse
        });
        type TaskExchange = [string, string];

        let taskExchanges: TaskExchange[] = [];
        let haikuTasks: string[] = [];

        while (true) {
            const previousResults: string[] = taskExchanges.map(([_, result]) => result);
            const opusResult: string | null = await opusOrchestrator(objective, previousResults);

            if (opusResult === null) {
                break;
            }

            if (opusResult.includes("The task is complete:")) {
                const finalOutput: string = opusResult.replace("The task is complete:", "").trim();
                break;
            } else {
                const subTaskPrompt: string = opusResult;
                const subTaskResult: string | null = await haikuSubAgent(subTaskPrompt, haikuTasks);
                if (subTaskResult === null) {
                    break;
                }
                haikuTasks.push(`Task: ${subTaskPrompt}\nResult: ${subTaskResult}`);
                taskExchanges.push([subTaskPrompt, subTaskResult]);
            }
        }
        const refinedOutput: string | null = await opusRefine(objective, taskExchanges.map(([_, result]) => result));

        if (refinedOutput === null) {
            console.log("Failed to generate the refined final output.");
        } else {
            let exchangeLog: string = `Objective: ${objective}\n\n`;
            exchangeLog += "=".repeat(40) + " Task Breakdown " + "=".repeat(40) + "\n\n";
            taskExchanges.forEach((exchange, index) => {
                const [prompt, result] = exchange;
                exchangeLog += `Task ${index + 1}:\n`;
                exchangeLog += `Prompt: ${prompt}\n`;
                exchangeLog += `Result: ${result}\n\n`;
            });

            exchangeLog += "=".repeat(40) + " Refined Final Output " + "=".repeat(40) + "\n\n";
            exchangeLog += refinedOutput;

            console.log("\nRefined Final output:\n%s", refinedOutput);
            return {
                finalOutput: exchangeLog
            };
        }
    } catch (error) {
        console.error('Error processing task:', error);
        throw error;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'processTask') {
        const { objective, apiKey } = message;

        processTask(objective, apiKey)
            .then((result) => {
                sendResponse({ success: true, result });
            })
            .catch((error) => {
                console.error('Error processing task:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }
});