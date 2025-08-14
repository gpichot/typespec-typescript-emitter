import { EmitContext, Namespace, Type } from "@typespec/compiler";
import { getHttpOperation } from "@typespec/http";
import { resolveType } from "./emit_types_resolve.js";

function getImports(namespace: Namespace): string {
  const namespaceFile = namespace.name;
  return Array.from([
    ...namespace.models.keys(),
    ...namespace.enums.keys(),
    ...namespace.unions.keys(),
  ])
    .map((m) => `import type { ${m} } from "./${namespaceFile}.ts";`)
    .join("\n");
}

export const emitRoutedTypemap = (
  context: EmitContext,
  namespace: Namespace,
): string => {
  const ops: {
    [K: string]: {
      // "string" in these does not refer to the type "string"! It's the typescript code as string.
      params: string;
      queryParams: string;
      request: string;
      response: Array<{ status: number | "unknown"; body: string }>;
    };
  } = {};

  const traverseNamespace = (n: Namespace): void => {
    // operations
    n.operations.forEach((op) => {
      const httpOp = getHttpOperation(context.program, op);
      const identifier = httpOp[0].path;
      ops[identifier] = {
        params: "{}",
        queryParams: "{}",
        request: "null",
        response: [{ status: 200, body: "unknown" }],
      };

      // request
      const args = Array.from(op.parameters.properties.values());
      const params = args.filter((p) =>
        p.decorators.some((d) => d.definition?.name === "@path"),
      );
      const paramsDef = `{
        ${params.map((p) => `${p.name}: ${resolveType(p.type, 1, namespace, context)}`).join(", ")} 
      }`;
      const queryParams = args.filter((p) =>
        p.decorators.some((d) => d.definition?.name === "@query"),
      );
      const queryParamsDef = `{
        ${queryParams
          .map((p) => {
            const optional = p.optional ? "?" : "";
            return `${p.name}${optional}: ${resolveType(p.type, 1, namespace, context)}`;
          })
          .join(", ")}
      }`;
      const body = args.filter((p) =>
        p.decorators.some((d) => d.definition?.name === "@body"),
      );

      let request = "null";
      if (body.length > 0) {
        request = resolveType(body[0].type, 1, namespace, context);
      }
      ops[identifier].params = paramsDef;
      ops[identifier].queryParams = queryParamsDef;
      ops[identifier].request = request;

      // response
      if (op.returnType && op.returnType.kind) {
        const getReturnType = (t: Type): (typeof ops)[string]["response"] => {
          const ret: (typeof ops)[string]["response"] = [];
          if (t.kind === "Model") {
            // if the return type is a model, it may have a fully qualified body
            const modelret: (typeof ret)[number] = {
              status: 200,
              body: "unknown",
            };
            let wasQualifiedBody = false;
            t.properties.forEach((prop) => {
              prop.decorators.forEach((dec) => {
                // one of the properties may be the status code
                if (
                  dec.definition?.name === "@statusCode" &&
                  prop.type.kind === "Number"
                )
                  modelret.status = prop.type.value;
                // one of the properties may be the body definition
                if (dec.definition?.name === "@body") {
                  modelret.body = resolveType(prop.type, 1, namespace, context);
                  wasQualifiedBody = true;
                }
              });
            });
            // ... if not, we assume status 200 and treat the model as the body
            if (!wasQualifiedBody) {
              modelret.body = resolveType(t, 1, namespace, context);
            }
            ret.push(modelret);
          } else if (t.kind === "Union") {
            // if the return type is a union, we have to check and resolve all variants
            // the union could either be a body-only definition or fully qualified (see above)
            t.variants.forEach((variant) => {
              ret.push(...getReturnType(variant.type));
            });
          } else ret.push({ status: 200, body: resolveType(t, 1, namespace) });
          return ret;
        };
        ops[identifier].response = getReturnType(op.returnType);
      }
    }); // end operations

    // get and traverse all namespaces
    n.namespaces.forEach((ns) => traverseNamespace(ns));
  };

  traverseNamespace(namespace);
  let out = `
${getImports(namespace)}

export type types_${context.options["root-namespace"]} = {\n`;
  out += Object.entries(ops)
    .map((op) => {
      let ret = `  ['${op[0]}']: {\n`;
      ret += `    params: ${op[1].params}\n`;
      ret += `    queryParams: ${op[1].queryParams}\n`;
      ret += `    request: ${op[1].request}\n`;
      ret += `    response: ${op[1].response.map((res) => `{status: ${res.status}, body: ${res.body}}`).join(" | ")}\n`;
      ret += "  }";
      return ret;
    })
    .join(",\n");
  out += "\n};\n";
  return out;
};
