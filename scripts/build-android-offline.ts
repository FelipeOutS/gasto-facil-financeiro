// Usage: bun scripts/build-android-offline.ts <Android project's app/src/main/assets/offline.js>
const outfile = process.argv[2];
if (!outfile) throw new Error("Informe o caminho de saída offline.js no projeto Android.");
const result = await Bun.build({
  entrypoints: ["src/lib/offline/android-offline-entry.ts"],
  target: "browser",
  minify: true,
});
if (!result.success || result.outputs.length !== 1)
  throw new Error("Não foi possível gerar o módulo offline.");
await Bun.write(outfile, result.outputs[0]);
console.log(`Módulo offline gerado: ${outfile}`);
