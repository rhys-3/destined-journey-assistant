import { descriptionSnapshot } from './descriptions.js';

export const SEARCH_FIELDS = [['name', '条目名'], ['content', '正文'], ['description', '简介'], ['id', 'ID']];

export function searchFields(state) {
  const selected = SEARCH_FIELDS.map(([key]) => key).filter(key => state.searchFields?.includes(key));
  return selected.length ? selected : ['name'];
}

export function searchPlaceholder(state) {
  const selected = searchFields(state);
  return `搜索${SEARCH_FIELDS.filter(([key]) => selected.includes(key)).map(([, label]) => label).join('、')}`;
}

export function filterSearchPrompts(prompts, state) {
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN');
  const terms = normalize(state.search).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return prompts;
  const selected = searchFields(state);
  return prompts.filter(({ prompt }) => {
    const fields = selected.flatMap(key => key === 'description'
      ? Object.values(descriptionSnapshot(prompt)) : [prompt[key]]).map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  });
}
