export interface AgentToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const VPS_AGENT_TOOLS: readonly AgentToolSchema[] = [
  {
    name: 'bash',
    description: 'Run a shell command in the VPS workspace directory. Use for running tests, scripts, git, builds, or inspecting the environment.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute via /bin/bash.' },
        cwd: { type: 'string', description: 'Optional working directory override.' },
        timeout: { type: 'number', description: 'Optional timeout in milliseconds (default 120000).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read',
    description: 'Read a text file from the VPS workspace with optional line range.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative or absolute file path.' },
        offset: { type: 'number', description: '1-based start line number.' },
        limit: { type: 'number', description: 'Maximum number of lines to read.' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'write',
    description: 'Create or overwrite a text file in the VPS workspace.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative or absolute file path.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['filePath', 'content'],
    },
  },
  {
    name: 'edit',
    description: 'Replace an exact text snippet inside an existing file.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Relative or absolute file path.' },
        oldString: { type: 'string', description: 'Exact text to find.' },
        newString: { type: 'string', description: 'Replacement text.' },
        replaceAll: { type: 'boolean', description: 'Replace all occurrences if true.' },
      },
      required: ['filePath', 'oldString', 'newString'],
    },
  },
  {
    name: 'ls',
    description: 'List files and directories inside a path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (defaults to workspace root).' },
      },
    },
  },
  {
    name: 'grep',
    description: 'Search text or regex pattern across files in the VPS workspace.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex or literal search pattern.' },
        path: { type: 'string', description: 'Directory or file to search (defaults to workspace root).' },
        include: { type: 'string', description: 'Optional file glob filter (e.g. "*.ts").' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'canvas_get_overview',
    description: 'List all nodes (id, type, title, position, preview) and edges on the current Pulse Canvas workspace.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'canvas_read_node',
    description: 'Read the full content and metadata of a specific canvas node by nodeId.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Target canvas node ID.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'canvas_create_node',
    description: 'Create a new card/node on the Pulse Canvas (text note, frame, or url) and optionally connect it from an existing node.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['text', 'frame', 'url'], description: 'Node type (default: text).' },
        title: { type: 'string', description: 'Node title.' },
        content: { type: 'string', description: 'Markdown content for text nodes.' },
        url: { type: 'string', description: 'URL for url nodes.' },
        color: { type: 'string', description: 'Optional accent color key.' },
        x: { type: 'number', description: 'Optional x coordinate.' },
        y: { type: 'number', description: 'Optional y coordinate.' },
        width: { type: 'number', description: 'Optional width.' },
        height: { type: 'number', description: 'Optional height.' },
        connectFromNodeId: { type: 'string', description: 'Optional source node ID to connect an edge from.' },
        edgeLabel: { type: 'string', description: 'Optional label for the created edge.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'canvas_update_node',
    description: 'Update an existing canvas node title, markdown content, color, or geometry.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Target canvas node ID.' },
        title: { type: 'string', description: 'Updated title.' },
        content: { type: 'string', description: 'Updated markdown content.' },
        color: { type: 'string', description: 'Updated color.' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'canvas_delete_node',
    description: 'Delete a canvas node and its connected edges.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Target canvas node ID.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'canvas_create_edge',
    description: 'Connect two canvas nodes with a directed edge.',
    parameters: {
      type: 'object',
      properties: {
        fromNode: { type: 'string', description: 'Source node ID.' },
        toNode: { type: 'string', description: 'Target node ID.' },
        label: { type: 'string', description: 'Optional edge label.' },
      },
      required: ['fromNode', 'toNode'],
    },
  },
  {
    name: 'load_skill',
    description: 'Load the full instructions of an available Pulse Skill by name before following it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact skill name from the available skills list.' },
      },
      required: ['name'],
    },
  },
];
