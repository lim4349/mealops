import type { ParsedCommand, Command, ServiceResponse } from '../core/types.js';

export class CommandHandler {
  parseCommand(text: string): ParsedCommand {
    const trimmed = text.trim();
    const parts = trimmed.split(/\s+/);
    const commandStr = parts[0]?.toLowerCase().replace('/', '') || '';

    return {
      command: this.mapCommand(commandStr),
      args: [],
    };
  }

  private mapCommand(cmd: string): Command {
    const commandMap: Record<string, Command> = {
      '밥줘': 'help',
      '벅벅': 'help',
      '도움': 'help',
      'help': 'help',
    };

    return commandMap[cmd] ?? 'help';
  }

  async handle(): Promise<ServiceResponse> {
    return {
      success: true,
      message: '',
      cardType: 'main_menu',
    };
  }
}
