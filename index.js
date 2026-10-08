import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Registry this provider publishes into. */
export const inject = ['skills'];
/** Cordis plugin identity. */
export const name = 'h3-motion-transfer';

const SKILL_NAME = 'h3-compact-motion-transfer';
const PROVIDER = 'dsh-h3-motion-transfer';
const assetRoot = fileURLToPath(new URL('./assets/', import.meta.url));

/**
 * Split a skill document into its YAML frontmatter and instruction body.
 * The body keeps the exact bytes the author wrote.
 */
function parseSkill(raw, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  const block = match?.[1];
  if (block === undefined) throw new Error(`${PROVIDER}: ${path} has no YAML frontmatter`);
  const read = (key) => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'mu').exec(block);
    if (line === null) return undefined;
    return line[1].trim().replace(/^["']|["']$/gu, '');
  };
  const description = read('description');
  if (description === undefined || description.length === 0) {
    throw new Error(`${PROVIDER}: ${path} has no description`);
  }
  return { description, content: raw.slice(match[0].length).trim() };
}

/**
 * Publish the MiniMax H3 motion-transfer prompt skill.
 * @param ctx - Context carrying the skill registry.
 */
export function apply(ctx) {
  const locator = join(assetRoot, 'SKILL.md');
  let summary;
  const provider = {
    name: PROVIDER,
    async list() {
      const { description } = parseSkill(await readFile(locator, 'utf8'), locator);
      summary = {
        name: SKILL_NAME,
        description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: PROVIDER,
        source: 'custom',
        rank: 0,
        locator,
        path: locator,
        resourceBase: { kind: 'directory', path: assetRoot },
      };
      return [summary];
    },
    async get(candidate, options) {
      const { content } = parseSkill(await readFile(locator, 'utf8'), locator);
      const { rank: _rank, locator: _locator, ...rest } = candidate;
      return { ...rest, content, metadata: { ...(candidate.metadata ?? {}), cwd: options?.cwd } };
    },
  };
  ctx.skills.registerProvider(() => provider);
}
