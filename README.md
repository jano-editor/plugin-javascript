# jano-plugin-javascript

JavaScript and TypeScript syntax highlighting plugin for [jano editor](https://janoeditor.dev).

## Features

- Keywords, including TypeScript (`interface`, `type`, `enum`, `implements`, ...)
- Strings, template strings with `${...}` interpolation, also across lines
- Block comments across lines, line comments
- Regex literals (told apart from division)
- Numbers: hex, binary, octal, separators (`1_000`), BigInt (`10n`)
- Functions, methods, properties, types, constants (`MAX_SIZE`), decorators (`@Component`)
- Auto-indent on Enter after `{`, `(`, `[` and `=>`

## Install

```bash
jano plugin install javascript
```

## Supported Files

- `.js`, `.mjs`, `.cjs`, `.jsx`
- `.ts`, `.mts`, `.cts`, `.tsx`

## License

MIT
