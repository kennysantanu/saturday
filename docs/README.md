# Saturday documentation

These guides describe implemented behavior. Development status and platform verification limits are separate from available features.

| Guide                                                           | Audience and purpose                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Project README](../README.md)                                  | Everyone: app overview, AI installation prompt, and quick manual setup                        |
| [Installation guide](installation-guide.md)                     | Users and agents: requirements, setup, paths, server controls, updates, repair, and uninstall |
| [User guide](user-guide.md)                                     | Users: jobs, Network, documents, Profile, backups, and Settings workflows                     |
| [Assistant guide](assistant-guide.md)                           | Users: connect a local MCP client, verify access, and troubleshoot                            |
| [MCP reference](mcp-reference.md)                               | Agents and developers: tool inputs, filters, IDs, conflict tokens, and mutation safeguards    |
| [Agent setup and recovery guide](agent-guide.md)                | Agents: workspace preservation, verification/reporting, and CLI/offline data recovery         |
| [Release notes](release-notes.md)                               | Users and testers: version 0.1.0 features, limits and release status                          |
| [Contributing](contributing.md)                                 | Developers: source map, development commands, storage contracts, and checks                   |
| [Application architecture](application-architecture.md)         | Developers: shared operations, local adapters, capabilities, assistant and storage boundaries |
| [Cloudflare and hosted storage](cloudflare-storage-contract.md) | Developers: local runtime checks and PostgreSQL/private-storage contract requirements         |
| [Design guide](design-guide.md)                                 | UI contributors: shared components, responsive layout, and accessibility                      |
| [Extension guide](extension-guide.md)                           | Extension users/authors: trusted packages, API, lifecycle, and independent recovery           |

Use the installation guide for application operations and the agent guide for advanced data recovery. Keep detailed tool contracts in the MCP reference; the assistant guide focuses on connecting and using a client.

For implementation details, start with the source map in Contributing. Tool schemas in `src/lib/application/assistant-catalog.js`, the MCP adapter in `src/lib/server/mcp-server.js`, scripts in `package.json`, and current source define executable behavior; update the owning guide when those contracts change.

## Find help by task

- **Install, open or update:** [managed installation](installation-guide.md#managed-installation) and [updates](installation-guide.md#updates).
- **Use the app:** [user guide](user-guide.md) for jobs, people, reminders, tags, documents and Profile.
- **Recover access or data:** [password recovery](installation-guide.md#password-login-and-local-recovery) and [backup/recovery commands](agent-guide.md#backup-and-recovery-commands).
- **Connect an assistant:** [connection and verification](assistant-guide.md#connect).
- **Develop a feature:** [source map and checks](contributing.md), [application architecture](application-architecture.md) and [design conventions](design-guide.md).
- **Author an extension:** [extension guide](extension-guide.md).

A connected assistant can call `search_documentation` with no query for the bundled guide index, search by a short phrase, then call `read_documentation` using the returned IDs. Help comes from the installed build and works offline with the UI stopped; it cannot execute recovery commands. Developer/extension topics describe authoring, not additional end-user setup requirements.
