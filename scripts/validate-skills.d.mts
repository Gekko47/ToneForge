/**
 * Type declarations for the agent-skill validator.
 */

export interface ParsedFrontmatter {
  data: Record<string, string>;
  content: string;
}

export declare function parseFrontmatter(text: string, file: string): ParsedFrontmatter | null;
