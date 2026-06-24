import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/index.js";

describe("MCP server surface (in-memory transport)", () => {
  it("advertises 7 tools, 4 prompts, and resources", async () => {
    const server = await buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);

    const tools = await client.listTools();
    expect(tools.tools.length).toBe(7);
    expect(tools.tools.map((t) => t.name).sort()).toEqual(
      ["critique_artifact", "direct_creative_work", "get_pattern", "get_quality_trends", "improve_artifact", "list_patterns", "recall_sessions"].sort(),
    );

    const prompts = await client.listPrompts();
    expect(prompts.prompts.length).toBe(4);

    const resources = await client.listResources();
    expect(resources.resources.length).toBeGreaterThanOrEqual(1);

    await client.close();
    await server.close();
  });

  it("list_patterns returns the 12 loaded patterns", async () => {
    const server = await buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);

    const res = await client.callTool({ name: "list_patterns", arguments: {} });
    const sc = res.structuredContent as { patterns: { id: string }[] } | undefined;
    expect(sc?.patterns.length).toBe(12);
    await client.close();
    await server.close();
  });

  it("get_pattern returns a full pattern body", async () => {
    const server = await buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);

    const res = await client.callTool({ name: "get_pattern", arguments: { patternId: "fantasy-fireball" } });
    const sc = res.structuredContent as { id: string; requiredElements: { name: string }[] } | undefined;
    expect(sc?.id).toBe("fantasy-fireball");
    expect(sc?.requiredElements.some((e) => e.name === "glowing-core")).toBe(true);
    await client.close();
    await server.close();
  });

  it("critique_artifact evaluates an HTML artifact and returns dimension scores", async () => {
    const server = await buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);

    const html = "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>x</title></head><body><main><h1>Hi</h1></main></body></html>";
    const res = await client.callTool({ name: "critique_artifact", arguments: { artifact: { kind: "html", content: html } } });
    const sc = res.structuredContent as { aggregateScore: number; findings: unknown[]; recommendedNextStep: string } | undefined;
    expect(typeof sc?.aggregateScore).toBe("number");
    expect(sc.aggregateScore).toBeGreaterThanOrEqual(0);
    expect(sc.aggregateScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(sc?.findings)).toBe(true);
    await client.close();
    await server.close();
  });
});
