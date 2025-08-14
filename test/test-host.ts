import { Diagnostic, resolvePath } from "@typespec/compiler";
import {
  createTestHost,
  createTestWrapper,
  expectDiagnosticEmpty,
} from "@typespec/compiler/testing";
import { TypespecTypescriptEmitterTestLibrary } from "../src/testing/index.js";
import { HttpTestLibrary } from "@typespec/http/testing";

export async function createTypespecTypescriptRoutesTestHost() {
  return createTestHost({
    libraries: [TypespecTypescriptEmitterTestLibrary, HttpTestLibrary],
  });
}

export async function createTypespecTypescriptRoutesTestRunner() {
  const host = await createTypespecTypescriptRoutesTestHost();

  return createTestWrapper(host, {
    autoImports: ["@typespec/http"],
    autoUsings: ["TypeSpec.Http"],
    compilerOptions: {
      noEmit: false,
      emit: ["typespec-typescript-emitter"],
      options: {
        "@gpichot/typespec-typescript-emitter": {
          "root-namespace": "TestNamespace",
          "enable-types": true,
          "enable-routed-typemap": true,
        },
      },
    },
  });
}

export async function emitWithDiagnostics(
  code: string,
): Promise<[Record<string, string>, readonly Diagnostic[]]> {
  const runner = await createTypespecTypescriptRoutesTestRunner();
  await runner.compileAndDiagnose(code, {
    outputDir: "tsp-output",
  });
  const emitterOutputDir = "./tsp-output/@gpichot/typespec-typescript-emitter";
  const files = await runner.program.host.readDir(emitterOutputDir);

  const result: Record<string, string> = {};
  for (const file of files) {
    result[file] = (
      await runner.program.host.readFile(resolvePath(emitterOutputDir, file))
    ).text;
  }
  return [result, runner.program.diagnostics];
}

export async function emit(code: string): Promise<Record<string, string>> {
  const [result, diagnostics] = await emitWithDiagnostics(code);
  expectDiagnosticEmpty(diagnostics);
  return result;
}
