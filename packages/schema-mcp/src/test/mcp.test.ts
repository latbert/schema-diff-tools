import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildServer, registerSchemaTools } from '../index.js';

async function connect() {
  const server = buildServer({
    name: 'schema-mcp-test',
    version: '0.0.0-test',
    defaultPort: 0,
    register: (s) => registerSchemaTools(s),
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'schema-mcp-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function payload(res: unknown): any {
  const content = (res as { content?: { text?: string }[] }).content;
  return JSON.parse(content![0].text!);
}

describe('schema-mcp tool surface', () => {
  it('lists both tools with rich descriptions and object schemas', async () => {
    const { client, server } = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['schema_diff', 'schema_validate']);
    for (const t of tools.tools) {
      expect(t.description!.length).toBeGreaterThan(60);
      expect(t.inputSchema.type).toBe('object');
    }
    await client.close();
    await server.close();
  });

  it('schema_diff classifies a breaking change from inline objects', async () => {
    const { client, server } = await connect();
    const res = await client.callTool({
      name: 'schema_diff',
      arguments: {
        old_schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        new_schema: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'number' } },
          required: ['a', 'b'],
        },
      },
    });
    const p = payload(res);
    expect(p.hasBreaking).toBe(true);
    expect(p.breakingCount).toBe(1);
    expect(p.nonBreakingCount).toBe(1);
    expect(Array.isArray(p.notSupportedKeywords)).toBe(true);
    await client.close();
    await server.close();
  });

  it('schema_diff accepts JSON strings and local file paths', async () => {
    const oldFile = path.join(dir, 'old.json');
    writeFileSync(oldFile, JSON.stringify({ properties: { n: { minimum: 0 } } }));
    const { client, server } = await connect();
    const res = await client.callTool({
      name: 'schema_diff',
      arguments: {
        old_schema: oldFile,
        new_schema: JSON.stringify({ properties: { n: { minimum: 10 } } }),
      },
    });
    const p = payload(res);
    expect(p.hasBreaking).toBe(true);
    expect(p.changes[0].kind).toBe('minimum_tightened');
    await client.close();
    await server.close();
  });

  it('schema_diff returns structured errors for invalid inputs', async () => {
    const { client, server } = await connect();
    const res = await client.callTool({
      name: 'schema_diff',
      arguments: { old_schema: '{not json', new_schema: {} },
    });
    expect(payload(res)).toMatchObject({ isError: true, code: 'invalid_json' });
    await client.close();
    await server.close();
  });

  it('schema_validate validates an instance with sorted issues', async () => {
    const { client, server } = await connect();
    const res = await client.callTool({
      name: 'schema_validate',
      arguments: {
        schema: {
          type: 'object',
          properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' } },
          required: ['name'],
        },
        instance: { email: 'nope' },
      },
    });
    const p = payload(res);
    expect(p.valid).toBe(false);
    expect(p.issues.map((i: { keyword: string }) => i.keyword).sort()).toEqual(['format', 'required']);
    await client.close();
    await server.close();
  });

  it('is byte-deterministic over repeated identical calls', async () => {
    const old = { definitions: { v: { enum: ['a', 'b'] } }, properties: { x: { $ref: '#/definitions/v' } } };
    const now = { definitions: { v: { enum: ['a'] } }, properties: { x: { $ref: '#/definitions/v' } } };
    const { client, server } = await connect();
    const r1 = await client.callTool({ name: 'schema_diff', arguments: { old_schema: old, new_schema: now } });
    const r2 = await client.callTool({ name: 'schema_diff', arguments: { old_schema: old, new_schema: now } });
    expect((r1.content as { text: string }[])[0].text).toBe((r2.content as { text: string }[])[0].text);
    await client.close();
    await server.close();
  });
});
