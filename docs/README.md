# Saturday documentation

These guides describe implemented behavior. Development status and platform verification limits are separate from available features.

| Guide                                            | Audience and purpose                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [Project README](../README.md)                   | Everyone: app overview, AI installation prompt, and quick manual setup                        |
| [Installation guide](installation-guide.md)      | Users and agents: requirements, setup, paths, server controls, updates, repair, and uninstall |
| [User guide](user-guide.md)                      | Users: jobs, Network, documents, Profile, backups, and Settings workflows                     |
| [Assistant guide](assistant-guide.md)            | Users: connect a local MCP client, verify access, and troubleshoot                            |
| [MCP reference](mcp-reference.md)                | Agents and developers: tool inputs, filters, IDs, conflict tokens, and mutation safeguards    |
| [Agent setup and recovery guide](agent-guide.md) | Agents: workspace preservation, verification/reporting, and CLI/offline data recovery         |
| [Contributing](contributing.md)                  | Developers: source map, development commands, storage contracts, and checks                   |
| [Design guide](design-guide.md)                  | UI contributors: shared components, responsive layout, and accessibility                      |
| [Extension guide](extension-guide.md)            | Extension users/authors: trusted packages, API, lifecycle, and independent recovery           |

Use the installation guide for application operations and the agent guide for advanced data recovery. Keep detailed tool contracts in the MCP reference; the assistant guide focuses on connecting and using a client.

For implementation details, start with the source map in Contributing. Tool schemas in `src/lib/server/mcp-server.js`, scripts in `package.json`, and current source define executable behavior; update the owning guide when those contracts change.
