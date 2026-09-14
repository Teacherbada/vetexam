import { EXAM_SUBJECTS, validChapter } from '../data/exam-chapters';
export const NOTE_TITLE_MAX_LENGTH = 120;
export const NOTE_CONTENT_MAX_LENGTH = 15000;
export const NOTE_BODY_MAX_BYTES = 65536;
export const NOTE_PAGE_SIZE = 20;
export type NoteInput = { type: 'official' | 'community'; title: string; content: string; subject: string; chapter: string; visibility: 'public' | 'private'; status: 'draft' | 'published' | 'active' | 'hidden' };
export type NoteView = NoteInput & { id: string; authorName: string; createdAt: string; updatedAt: string; canEdit: boolean; helpful: number; isHelpful: boolean; isFavorite: boolean; canReact: boolean };
export type NoteFilters = { subject: string; chapter: string; tab: 'all' | 'official' | 'community' | 'mine' | 'favorites'; sort: 'latest' | 'helpful'; page: number };
export type NoteList = { notes: NoteView[]; page: number; hasMore: boolean; signedIn: boolean; admin: boolean };
export function parseNote(value: unknown): NoteInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== 'chapter,content,status,subject,title,type,visibility') return null;
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > NOTE_TITLE_MAX_LENGTH || typeof row.content !== 'string' || !row.content.trim() || row.content.length > NOTE_CONTENT_MAX_LENGTH) return null;
  if (!EXAM_SUBJECTS.includes(String(row.subject)) || typeof row.chapter !== 'string' || !row.chapter || !validChapter(String(row.subject), row.chapter)) return null;
  if (row.type === 'official' ? row.visibility !== 'public' || !['draft','published'].includes(String(row.status)) : row.type !== 'community' || !['private','public'].includes(String(row.visibility)) || !['active','hidden'].includes(String(row.status))) return null;
  // Plain text only. No encoded binary payloads; HTML-like text is displayed literally.
  if (/\u0000|data:[^\s]*;base64,/i.test(row.content + row.title)) return null;
  return { ...row, title: row.title.trim(), content: row.content.trim() } as NoteInput;
}
export function parseNoteFilters(params: URLSearchParams): NoteFilters | null {
  const subject = params.get('subject') ?? '', chapter = params.get('chapter') ?? '', tab = params.get('tab') ?? 'all', sort = params.get('sort') ?? 'latest', page = params.get('page') ?? '1';
  if (subject && !EXAM_SUBJECTS.includes(subject) || chapter && (!subject || !validChapter(subject, chapter)) || !['all','official','community','mine','favorites'].includes(tab) || !['latest','helpful'].includes(sort) || !/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 10000) return null;
  return { subject, chapter, tab, sort, page: Number(page) } as NoteFilters;
}
export function relatedNotesHref(subject: string, chapter: string) { return `/notes?${new URLSearchParams({ subject, chapter, sort: 'helpful' })}`; }
export function validNoteId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
