import type { ClarificationRequest } from 'pulse-coder-engine';

interface PendingRequest {
  request: ClarificationRequest;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

interface InputManagerOptions {
  onRequest?: (request: ClarificationRequest) => void;
}

/**
 * InputManager handles asynchronous user input for clarification requests.
 * It manages pending clarification requests and coordinates with the active CLI interface.
 */
export class InputManager {
  private pendingRequest: PendingRequest | null = null;
  private readonly onRequest?: (request: ClarificationRequest) => void;

  constructor(options: InputManagerOptions = {}) {
    this.onRequest = options.onRequest ?? this.printRequest;
  }

  /**
   * Request user input for a clarification
   * @param request The clarification request details
   * @returns Promise that resolves with the user's answer
   */
  async requestInput(request: ClarificationRequest): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // If there's already a pending request, reject this one
      if (this.pendingRequest) {
        reject(new Error('Another clarification request is already pending'));
        return;
      }

      this.onRequest?.(request);

      // Set up timeout if specified
      let timeoutId: NodeJS.Timeout | undefined;
      if (request.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (this.pendingRequest?.request.id === request.id) {
            const error = new Error(`Clarification request timed out after ${request.timeout}ms`);
            this.pendingRequest.reject(error);
            this.pendingRequest = null;
          }
        }, request.timeout);
      }

      // Store the pending request
      this.pendingRequest = {
        request,
        resolve,
        reject,
        timeoutId
      };
    });
  }

  /**
   * Handle user input - checks if there's a pending clarification request
   * @param input The user's input
   * @returns true if input was consumed by a pending clarification, false otherwise
   */
  handleUserInput(input: string): boolean {
    if (!this.pendingRequest) {
      return false;
    }

    // Clear the timeout if it exists
    if (this.pendingRequest.timeoutId) {
      clearTimeout(this.pendingRequest.timeoutId);
    }

    // Resolve the pending request with the user's input
    const trimmedInput = input.trim();
    this.pendingRequest.resolve(trimmedInput);
    this.pendingRequest = null;

    return true;
  }

  /**
   * Cancel any pending clarification request
   * @param reason Optional cancellation reason
   */
  cancel(reason?: string): void {
    if (this.pendingRequest) {
      if (this.pendingRequest.timeoutId) {
        clearTimeout(this.pendingRequest.timeoutId);
      }

      this.pendingRequest.reject(new Error(reason || 'Clarification request cancelled'));
      this.pendingRequest = null;
    }
  }

  /**
   * Check if there's a pending clarification request
   */
  hasPendingRequest(): boolean {
    return this.pendingRequest !== null;
  }

  /**
   * Get the current pending request (for debugging/testing)
   */
  getPendingRequest(): ClarificationRequest | null {
    return this.pendingRequest?.request || null;
  }

  private printRequest(request: ClarificationRequest): void {
    console.log(`\n❓ ${request.question}`);
    if (request.context) {
      console.log(`   ${request.context}`);
    }
    if (request.defaultAnswer) {
      console.log(`   (Default: ${request.defaultAnswer})`);
    }
    console.log('');
  }
}
