import { parse, Lang } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';

export interface EmbeddedScript {
  code: string;
  lang: Lang;
}

function scriptLang(element: SgNode): Lang {
  const startTag = element.find({ rule: { kind: 'start_tag' } });
  if (!startTag) return Lang.JavaScript;
  const attrs = startTag.findAll({ rule: { kind: 'attribute' } });
  for (const attr of attrs) {
    const name = attr.find({ rule: { kind: 'attribute_name' } });
    if (name?.text() !== 'lang') continue;
    const value = attr.find({ rule: { kind: 'attribute_value' } })?.text();
    if (value === 'ts') return Lang.TypeScript;
    if (value === 'tsx') return Lang.Tsx;
  }
  return Lang.JavaScript;
}

// Extracts the contents of every `<script>` block in an HTML-like document,
// such as a Vue component or a Svelte component.
export function extractScripts(source: string): EmbeddedScript[] {
  const root = parse(Lang.Html, source).root();
  const scripts: EmbeddedScript[] = [];
  for (const element of root.findAll({ rule: { kind: 'script_element' } })) {
    const rawText = element.find({ rule: { kind: 'raw_text' } });
    if (!rawText) continue;
    scripts.push({ code: rawText.text(), lang: scriptLang(element) });
  }
  return scripts;
}
