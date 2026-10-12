# Interview Practice — Saturday extension API 1

One page, a separate SQLite question bank, and five MCP tools for questions and saved answers. Practice hides the answer and saves drafts only on request.

Install from Saturday’s repository after stopping web/MCP processes:

```sh
npm run extension -- install ./examples/extensions/interview-practice --trust
```

Enable Extensions in Settings, open Interview Practice, and reconnect your assistant. Copy this package to your own repository to create an extension; give it a unique manifest ID. No package dependencies or install scripts are needed. Follow Saturday’s [extension guide](https://github.com/kennysantanu/saturday/blob/main/docs/extension-guide.md) (also available at `docs/extension-guide.md` in your Saturday checkout) and design guide for the tested contract, lifecycle and recovery instructions.

Core backups do not include this question bank. Use the extension directory’s backup/restore actions. Removal retains data, and reinstalling compatible code reconnects it.
