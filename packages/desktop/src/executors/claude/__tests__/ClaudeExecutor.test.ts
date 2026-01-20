import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-pty before importing ClaudeExecutor
vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(),
  },
}));

// Mock the session manager
const mockSessionManager = {
  getSession: vi.fn(),
  addTimelineEvent: vi.fn(),
  updateSessionStatus: vi.fn(),
  addPanelConversationMessage: vi.fn(),
  persistPanelAgentSessionId: vi.fn(),
};

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  verbose: vi.fn(),
  debug: vi.fn(),
};

// Import after mocks
const { ClaudeExecutor } = await import('../ClaudeExecutor');

describe('ClaudeExecutor', () => {
  let executor: InstanceType<typeof ClaudeExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ClaudeExecutor(
      mockSessionManager as any,
      mockLogger as any
    );
  });

  describe('parseOutput - tool_use extraction from assistant messages', () => {
    it('should emit entry for tool_use in assistant message content', () => {
      const entrySpy = vi.fn();
      executor.on('entry', entrySpy);

      const assistantMessage = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01ABC',
              name: 'Read',
              input: { file_path: '/test.ts' },
            },
          ],
          stop_reason: 'tool_use',
        },
      });

      executor.parseOutput(assistantMessage, 'panel-1', 'session-1');

      // Should emit at least one entry for the tool_use
      const toolUseEntries = entrySpy.mock.calls.filter(
        (call) => call[0]?.entryType === 'tool_use'
      );
      expect(toolUseEntries.length).toBeGreaterThan(0);

      const toolUseEntry = toolUseEntries[0][0];
      expect(toolUseEntry.toolName).toBe('Read');
      expect(toolUseEntry.toolUseId).toBe('toolu_01ABC');
    });
  });

  describe('parseOutput - tool_result extraction from user messages', () => {
    it('should emit entry for tool_result in user message content', () => {
      const entrySpy = vi.fn();
      executor.on('entry', entrySpy);

      const userMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01ABC',
              content: 'File content here',
              is_error: false,
            },
          ],
        },
      });

      executor.parseOutput(userMessage, 'panel-1', 'session-1');

      // Should emit entry for the tool_result
      const toolResultEntries = entrySpy.mock.calls.filter(
        (call) => call[0]?.entryType === 'tool_result'
      );
      expect(toolResultEntries.length).toBeGreaterThan(0);

      const toolResultEntry = toolResultEntries[0][0];
      expect(toolResultEntry.toolUseId).toBe('toolu_01ABC');
      expect(toolResultEntry.toolStatus).toBe('success');
    });

    it('should emit entry with failed status for error tool_result', () => {
      const entrySpy = vi.fn();
      executor.on('entry', entrySpy);

      const userMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_error',
              content: 'File not found',
              is_error: true,
            },
          ],
        },
      });

      executor.parseOutput(userMessage, 'panel-1', 'session-1');

      const toolResultEntries = entrySpy.mock.calls.filter(
        (call) => call[0]?.entryType === 'tool_result'
      );
      expect(toolResultEntries.length).toBeGreaterThan(0);

      const toolResultEntry = toolResultEntries[0][0];
      expect(toolResultEntry.toolUseId).toBe('toolu_error');
      expect(toolResultEntry.toolStatus).toBe('failed');
    });

    it('should extract multiple tool_results from single user message', () => {
      const entrySpy = vi.fn();
      executor.on('entry', entrySpy);

      const userMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01',
              content: 'Result 1',
            },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_02',
              content: 'Result 2',
            },
          ],
        },
      });

      executor.parseOutput(userMessage, 'panel-1', 'session-1');

      const toolResultEntries = entrySpy.mock.calls.filter(
        (call) => call[0]?.entryType === 'tool_result'
      );
      expect(toolResultEntries.length).toBe(2);

      const ids = toolResultEntries.map((call) => call[0].toolUseId);
      expect(ids).toContain('toolu_01');
      expect(ids).toContain('toolu_02');
    });
  });

  describe('parseOutput - session_id extraction', () => {
    it('should emit agentSessionId when session_id is present', () => {
      const agentSessionIdSpy = vi.fn();
      executor.on('agentSessionId', agentSessionIdSpy);

      const message = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'claude-session-abc',
      });

      executor.parseOutput(message, 'panel-1', 'session-1');

      expect(agentSessionIdSpy).toHaveBeenCalledWith({
        panelId: 'panel-1',
        sessionId: 'session-1',
        agentSessionId: 'claude-session-abc',
      });
    });
  });

  describe('parseOutput - non-JSON handling', () => {
    it('should emit stdout for non-JSON output', () => {
      const outputSpy = vi.fn();
      executor.on('output', outputSpy);

      executor.parseOutput('Plain text output', 'panel-1', 'session-1');

      expect(outputSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stdout',
          data: 'Plain text output',
        })
      );
    });

    it('should handle empty output gracefully', () => {
      const outputSpy = vi.fn();
      executor.on('output', outputSpy);

      executor.parseOutput('', 'panel-1', 'session-1');
      executor.parseOutput('   ', 'panel-1', 'session-1');

      expect(outputSpy).not.toHaveBeenCalled();
    });
  });
});
