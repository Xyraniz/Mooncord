/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BuildContext, BuildOptions, context } from "esbuild";
import { copyFile, mkdir, readdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, resolve } from "path";

import vencordDep from "./vencordDep.mjs";
import { includeDirPlugin } from "./includeDirPlugin.mts";

const isDev = process.argv.includes("--dev");
const isVencordOnly = process.argv.includes("--vencord-only");

const VENCORD_ROOT = resolve("Vencord");
const VENCORD_DIST_DIR = join(VENCORD_ROOT, "dist");
const VENCORD_STATIC_DIR = resolve("static/vencord");
const VENCORD_ARTIFACT_PREFIXES = [
    "vencordDesktopMain.js",
    "vencordDesktopPreload.js",
    "vencordDesktopRenderer.js",
    "vencordDesktopRenderer.css"
];

function runPnpm(args: string[]) {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(pnpm, args, {
        cwd: VENCORD_ROOT,
        env: {
            ...process.env,
            CI: process.env.CI ?? "true",
            VENCORD_HASH: process.env.VENCORD_HASH || "vendored",
            VENCORD_REMOTE: process.env.VENCORD_REMOTE || "Vendicated/Vencord"
        },
        shell: process.platform === "win32",
        stdio: "inherit"
    });

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Vencord command failed with exit code ${result.status ?? "unknown"}`);
}

async function buildVencord() {
    if (!existsSync(VENCORD_ROOT)) {
        throw new Error(`Vencord source is missing: ${VENCORD_ROOT}`);
    }

    if (!existsSync(join(VENCORD_ROOT, "node_modules", "esbuild"))) {
        console.log("Installing Vencord dependencies...");
        runPnpm(["install", "--frozen-lockfile"]);
    }

    console.log("Building Vencord...");
    runPnpm(["build", "--standalone", "--disable-updater", ...(isDev ? ["--dev"] : [])]);

    const files = (await readdir(VENCORD_DIST_DIR)).filter(name =>
        VENCORD_ARTIFACT_PREFIXES.some(prefix => name.startsWith(prefix))
    );
    const missing = VENCORD_ARTIFACT_PREFIXES.filter(prefix => !files.some(file => file.startsWith(prefix)));
    if (missing.length) {
        throw new Error(`Vencord did not produce the required artifacts: ${missing.join(", ")}`);
    }

    await rm(VENCORD_STATIC_DIR, { recursive: true, force: true });
    await mkdir(VENCORD_STATIC_DIR, { recursive: true });
    await Promise.all(files.map(file => copyFile(join(VENCORD_DIST_DIR, file), join(VENCORD_STATIC_DIR, file))));
    console.log(`Copied ${files.length} local Vencord artifacts to ${VENCORD_STATIC_DIR}`);
}

await buildVencord();
if (isVencordOnly) process.exit(0);

const CommonOpts: BuildOptions = {
    minify: !isDev,
    bundle: true,
    sourcemap: "linked",
    logLevel: "info"
};

const NodeCommonOpts: BuildOptions = {
    ...CommonOpts,
    format: "cjs",
    platform: "node",
    external: ["electron"],
    target: ["esnext"],
    loader: {
        ".node": "file"
    },
    define: {
        IS_DEV: JSON.stringify(isDev)
    }
};

const contexts = [] as BuildContext[];
async function createContext(options: BuildOptions) {
    contexts.push(await context(options));
}

async function copyVenmic() {
    if (process.platform !== "linux") return;

    return Promise.all([
        copyFile(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-x64/node-napi-v7.node",
            "./static/dist/venmic-x64.node"
        ),
        copyFile(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-arm64/node-napi-v7.node",
            "./static/dist/venmic-arm64.node"
        )
    ]).catch(() => console.warn("Failed to copy venmic. Building without venmic support"));
}

async function copyLibVesktop() {
    if (process.platform !== "linux") return;

    try {
        await copyFile(
            "./packages/libvesktop/build/Release/vesktop.node",
            `./static/dist/libvesktop-${process.arch}.node`
        );
        console.log("Using local libvesktop build");
    } catch {
        console.log(
            "Using prebuilt libvesktop binaries. Run `pnpm buildLibVesktop` and build again to build from source - see README.md for more details"
        );
        return Promise.all([
            copyFile("./packages/libvesktop/prebuilds/vesktop-x64.node", "./static/dist/libvesktop-x64.node"),
            copyFile("./packages/libvesktop/prebuilds/vesktop-arm64.node", "./static/dist/libvesktop-arm64.node")
        ]).catch(() => console.warn("Failed to copy libvesktop. Building without libvesktop support"));
    }
}

await Promise.all([
    copyVenmic(),
    copyLibVesktop(),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        outfile: "dist/js/main.js",
        footer: { js: "//# sourceURL=VesktopMain" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/arrpc/worker.ts"],
        outfile: "dist/js/arRpcWorker.js",
        footer: { js: "//# sourceURL=VesktopArRpcWorker" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/js/preload.js",
        footer: { js: "//# sourceURL=VesktopPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/shell.ts"],
        outfile: "dist/js/shellPreload.js",
        footer: { js: "//# sourceURL=MooncordShellPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/splash.ts"],
        outfile: "dist/js/splashPreload.js",
        footer: { js: "//# sourceURL=VesktopSplashPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/updater.ts"],
        outfile: "dist/js/updaterPreload.js",
        footer: { js: "//# sourceURL=VesktopUpdaterPreload" }
    }),
    createContext({
        ...CommonOpts,
        globalName: "Vesktop",
        entryPoints: ["src/renderer/index.ts"],
        outfile: "dist/js/renderer.js",
        format: "iife",
        inject: ["./scripts/build/injectReact.mjs"],
        jsxFactory: "VencordCreateElement",
        jsxFragment: "VencordFragment",
        external: ["@vencord/types/*"],
        plugins: [vencordDep, includeDirPlugin("patches", "src/renderer/patches")],
        footer: { js: "//# sourceURL=VesktopRenderer" }
    })
]);

const watch = process.argv.includes("--watch");

if (watch) {
    await Promise.all(contexts.map(ctx => ctx.watch()));
} else {
    await Promise.all(
        contexts.map(async ctx => {
            await ctx.rebuild();
            await ctx.dispose();
        })
    );
}
