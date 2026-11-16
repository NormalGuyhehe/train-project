import { build, context } from "esbuild";

const dev = process.argv.includes("--dev");

const options = {
  entryPoints: ["src/main.ts"],
  outdir: "www/assets",
  bundle: true,
  format: "esm",
  target: "es2020",
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
};

if (dev) {
  const ctx = await context(options);
  await ctx.watch();
  const { hosts, port } = await ctx.serve({
    servedir: "www",
    host: "127.0.0.1",
    port: 8000,
  });
  console.log(`АТЛЕТ: http://${hosts[0]}:${port}`);
} else {
  await build(options);
}
