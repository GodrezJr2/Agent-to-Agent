Vendored from https://github.com/pablodelucca/pixel-agents (MIT, see LICENSE):
the webview office engine, layout editor, editor hooks/UI and the shared asset
helpers. Local changes: `vscodeApi.ts` is an in-page message bus shim and
`runtime.ts` is fixed to the browser runtime, and `browserMock.ts` gains an exported `getMockPayload()`. Keep other files unmodified so
they can be refreshed from upstream.
