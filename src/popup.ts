document.addEventListener('DOMContentLoaded', () => {
    const taskForm = document.getElementById('task-form') as HTMLFormElement;
    const objectiveInput = document.getElementById('objective') as HTMLInputElement;
    const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
    const progressLogsContainer = document.getElementById('progress-logs') as HTMLElement;
    const saveMdButton = document.getElementById('save-md') as HTMLButtonElement;
    let finalOutputText: string = "";

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'progressUpdate') {
            const currentContent = progressLogsContainer.innerHTML;
            progressLogsContainer.innerHTML = currentContent + '\n' + message.content;
        }
    });

    saveMdButton.addEventListener('click', () => {
        if (!finalOutputText) {
            displayErrorMessage("There's no content to save.");
            return;
        }

        const now = new Date();
        const timestamp = now.toISOString().split('T')[0] + '_' + now.getHours() + '-' + now.getMinutes();

        let sanitizedObjective = objectiveInput.value.trim().replace(/[^a-z0-9]/gi, '_').substring(0, 50);

        const filename = sanitizedObjective ? `${timestamp}_${sanitizedObjective}.md` : `${timestamp}_output.md`;

        const blob = new Blob([finalOutputText], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);

        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();


        URL.revokeObjectURL(url);
        document.body.removeChild(downloadLink);
    });

    taskForm?.addEventListener('submit', (event) => {
        event.preventDefault();

        const objective = objectiveInput?.value?.trim();
        const apiKey = apiKeyInput?.value?.trim();

        if (!objective) {
            displayErrorMessage('Please provide both the objective and the API key.');
            return;
        }

        taskForm.disabled = true;
        displayLoadingIndicator();

        chrome.runtime.sendMessage({ type: 'processTask', objective, apiKey }, (response) => {
            taskForm.disabled = false;

            if (response.success) {
                const { finalOutput } = response.result;
                finalOutputText = finalOutput;
            } else {
                displayErrorMessage(response.error);
            }

            hideLoadingIndicator();
        });
    });

    function displayErrorMessage(message: string) {
        alert(message);
    }

    function displayLoadingIndicator() {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (!loadingIndicator) {
            const indicatorElement = document.createElement('div');
            indicatorElement.id = 'loading-indicator';
            indicatorElement.textContent = 'Loading...';
            document.body.appendChild(indicatorElement);
        } else {
            loadingIndicator.style.display = 'block';
        }
    }

    function hideLoadingIndicator() {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
    }
});
