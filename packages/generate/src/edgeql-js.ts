import {adapter} from "edgedb";
// import {configFileHeader, exitWithError, runQBGenerator} from "./generate";
import {isTTY, CommandOptions, promptBoolean} from "./commandutil";
import type {ConnectConfig} from "edgedb/dist/conUtils";

// const {path, fs, readFileUtf8, exists} = adapter;

import {DirBuilder, dts, r, t} from "./builders";
import {createClient, Client, $} from "edgedb";
import {syntax} from "./FILES";

import * as genutil from "./genutil";

import {generateCastMaps} from "./edgeql-js/generateCastMaps";
import {generateScalars} from "./edgeql-js/generateScalars";
import {generateObjectTypes} from "./edgeql-js/generateObjectTypes";
import {generateRuntimeSpec} from "./edgeql-js/generateRuntimeSpec";
import {generateFunctionTypes} from "./edgeql-js/generateFunctionTypes";
import {generateOperators} from "./edgeql-js/generateOperatorTypes";
import {generateGlobals} from "./edgeql-js/generateGlobals";
import {generateSetImpl} from "./edgeql-js/generateSetImpl";
import {generateIndex} from "./edgeql-js/generateIndex";

const {path, fs, readFileUtf8, exists, exit, walk} = adapter;
const DEBUG = false;
export const configFileHeader = `// EdgeDB query builder. To update, run \`npx @edgedb/generate edgeql-js\``;

export type GeneratorParams = {
  dir: DirBuilder;
  types: $.introspect.Types;
  typesByName: Record<string, $.introspect.Type>;
  casts: $.introspect.Casts;
  scalars: $.introspect.ScalarTypes;
  functions: $.introspect.FunctionTypes;
  globals: $.introspect.Globals;
  operators: $.introspect.OperatorTypes;
};

export function exitWithError(message: string): never {
  // tslint:disable-next-line
  console.error(message);
  exit(1);
  throw new Error();
}

export type Target = "ts" | "esm" | "cjs" | "mts" | "deno";
export type Version = {
  major: number;
  minor: number;
};

export async function generateQueryBuilder(params: {
  root: string | null;
  options: CommandOptions;
  connectionConfig: ConnectConfig;
}) {
  const {root, options, connectionConfig} = params;

  let outputDir: string;
  if (options.out) {
    outputDir = path.isAbsolute(options.out)
      ? options.out
      : path.join(adapter.process.cwd(), options.out);
  } else if (root) {
    outputDir = path.join(root, "dbschema", "edgeql-js");
  } else {
    throw new Error(
      `No edgedb.toml found. Initialize an EdgeDB project with\n\`edgedb project init\` or specify an output directory with \`--output-dir\``
    );
  }

  let outputDirIsInProject = false;
  let prettyOutputDir;
  if (root) {
    const relativeOutputDir = path.posix.relative(root, outputDir);
    outputDirIsInProject =
      // !!relativeOutputDir &&
      // !path.isAbsolute(options.outputDir) &&
      !relativeOutputDir.startsWith("..");
    prettyOutputDir = outputDirIsInProject
      ? `./${relativeOutputDir}`
      : outputDir;
  } else {
    prettyOutputDir = outputDir;
  }

  if (await exists(outputDir)) {
    if (await canOverwrite(outputDir, options)) {
      // await rmdir(outputDir, {recursive: true});
    }
  } else {
    // output dir doesn't exist, so assume first run
    options.updateIgnoreFile = true;
  }

  // generate query builder
  const target = options.target!;
  let cxn: Client;
  try {
    cxn = createClient({
      ...connectionConfig,
      concurrency: 5
    });
  } catch (e) {
    exitWithError(`Failed to connect: ${(e as Error).message}`);
  }

  const dir = new DirBuilder();

  try {
    // tslint:disable-next-line
    console.log(`Introspecting database schema...`);

    const [types, scalars, casts, functions, operators, globals] =
      await Promise.all([
        $.introspect.getTypes(cxn, {debug: DEBUG}),
        $.introspect.getScalars(cxn),
        $.introspect.getCasts(cxn, {debug: DEBUG}),
        $.introspect.getFunctions(cxn),
        $.introspect.getOperators(cxn),
        $.introspect.getGlobals(cxn)
      ]);

    const typesByName: Record<string, $.introspect.Type> = {};
    for (const type of types.values()) {
      typesByName[type.name] = type;

      // skip "anytype" and "anytuple"
      if (!type.name.includes("::")) continue;
    }

    const generatorParams: GeneratorParams = {
      dir,
      types,
      typesByName,
      casts,
      scalars,
      functions,
      globals,
      operators
    };
    generateRuntimeSpec(generatorParams);
    generateCastMaps(generatorParams);
    generateScalars(generatorParams);
    generateObjectTypes(generatorParams);
    generateFunctionTypes(generatorParams);
    generateOperators(generatorParams);
    generateSetImpl(generatorParams);
    generateGlobals(generatorParams);
    generateIndex(generatorParams);

    // generate module imports

    const importsFile = dir.getPath("imports");

    importsFile.addExportStar("edgedb", {as: "edgedb"});
    importsFile.addExportFrom({spec: true}, "./__spec__", {
      allowFileExt: true
    });
    importsFile.addExportStar("./syntax", {
      allowFileExt: true,
      as: "syntax"
    });
    importsFile.addExportStar("./castMaps", {
      allowFileExt: true,
      as: "castMaps"
    });
  } finally {
    await cxn.close();
  }

  const initialFiles = new Set(await walk(outputDir));
  const written = new Set<string>();

  // write syntax files
  const syntaxOutDir = path.join(outputDir);
  if (!(await exists(syntaxOutDir))) {
    await fs.mkdir(syntaxOutDir);
  }

  const syntaxFiles = syntax[target];
  if (!syntaxFiles) {
    throw new Error(`Error: no syntax files found for target "${target}"`);
  }

  for (const f of syntaxFiles) {
    const outputPath = path.join(syntaxOutDir, f.path);
    written.add(outputPath);
    let oldContents = "";
    try {
      oldContents = await readFileUtf8(outputPath);
    } catch {}
    if (oldContents !== f.content) {
      await fs.writeFile(outputPath, f.content);
    }
  }

  if (target === "ts") {
    await dir.write(outputDir, {
      mode: "ts",
      moduleKind: "esm",
      fileExtension: ".ts",
      moduleExtension: "",
      written
    });
  } else if (target === "mts") {
    await dir.write(outputDir, {
      mode: "ts",
      moduleKind: "esm",
      fileExtension: ".mts",
      moduleExtension: ".mjs",
      written
    });
  } else if (target === "cjs") {
    await dir.write(outputDir, {
      mode: "js",
      moduleKind: "cjs",
      fileExtension: ".js",
      moduleExtension: "",
      written
    });
    await dir.write(outputDir, {
      mode: "dts",
      moduleKind: "esm",
      fileExtension: ".d.ts",
      moduleExtension: "",
      written
    });
  } else if (target === "esm") {
    await dir.write(outputDir, {
      mode: "js",
      moduleKind: "esm",
      fileExtension: ".mjs",
      moduleExtension: ".mjs",
      written
    });
    await dir.write(outputDir, {
      mode: "dts",
      moduleKind: "esm",
      fileExtension: ".d.ts",
      moduleExtension: "",
      written
    });
  } else if (target === "deno") {
    await dir.write(outputDir, {
      mode: "ts",
      moduleKind: "esm",
      fileExtension: ".ts",
      moduleExtension: ".ts",
      written
    });
  }

  const configPath = path.join(outputDir, "config.json");
  await fs.writeFile(
    configPath,
    `${configFileHeader}\n${JSON.stringify({target})}\n`
  );
  written.add(configPath);

  // delete all vestigial files
  for (const file of initialFiles) {
    if (written.has(file)) {
      continue;
    }
    await fs.rm(file);
  }
  // await runQBGenerator({outputDir, connectionConfig, target: options.target!});

  console.log(`Writing files to ${prettyOutputDir}`);
  console.log(`Generation complete! 🤘`);

  if (!outputDirIsInProject || !root) {
    console.log(
      `\nChecking the generated files into version control is
not recommended. Consider updating the .gitignore of your
project to exclude these files.`
    );
  } else if (options.updateIgnoreFile) {
    const gitIgnorePath = path.join(root, ".gitignore");

    let gitIgnoreFile: string | null = null;
    try {
      gitIgnoreFile = await readFileUtf8(gitIgnorePath);
    } catch {}

    const vcsLine = path.posix.relative(root, outputDir);

    if (
      gitIgnoreFile === null ||
      !RegExp(`^${vcsLine}$`, "m").test(gitIgnoreFile) // not already ignored
    ) {
      if (
        await promptBoolean(
          gitIgnoreFile === null
            ? `Checking the generated query builder into version control
is not recommended. Would you like to create a .gitignore file to ignore
the query builder directory? `
            : `Checking the generated query builder into version control
is not recommended. Would you like to update .gitignore to ignore
the query builder directory? The following line will be added:

   ${vcsLine}\n\n`,
          true
        )
      ) {
        await fs.appendFile(
          gitIgnorePath,
          `${gitIgnoreFile === null ? "" : "\n"}${vcsLine}\n`
        );
      }
    }
  }
}

async function canOverwrite(outputDir: string, options: CommandOptions) {
  if (options.forceOverwrite) {
    return true;
  }

  let config: any = null;
  try {
    const configFile = await readFileUtf8(path.join(outputDir, "config.json"));
    if (configFile.startsWith(configFileHeader)) {
      config = JSON.parse(configFile.slice(configFileHeader.length));

      if (config.target === options.target) {
        return true;
      }
    }
  } catch {}

  const error = config
    ? `A query builder with a different config already exists in that location.`
    : `Output directory '${outputDir}' already exists.`;

  if (
    isTTY() &&
    (await promptBoolean(`${error}\nDo you want to overwrite? `, true))
  ) {
    return true;
  }

  return exitWithError(`Error: ${error}`);
}
