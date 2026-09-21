import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { EXAM_SUBJECTS } from '@/data/exam-chapters';
import { CLASSIFICATION_BATCH_SIZE, CLASSIFICATION_MAX_CHARS, classificationInput, type ClassificationQuestion } from '@/lib/chapter-classification';
import { classifyChapterBatch } from '@/lib/chapter-classification-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: '章節 AI 分類僅限管理員使用。' }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 150000) return NextResponse.json({ error: '分類內容過大，請縮小批次。' }, { status: 413 });
    const body = JSON.parse(raw);
    if (!EXAM_SUBJECTS.includes(body.examSubject) || !Array.isArray(body.questions) || !body.questions.length || body.questions.length > CLASSIFICATION_BATCH_SIZE ||
      body.questions.some((q: ClassificationQuestion) => !q || typeof q.question !== 'string' || !q.question.trim() ||
        !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 5 || q.options.some(o => typeof o !== 'string') ||
        typeof q.answer !== 'string' || typeof q.explanation !== 'string')) {
      return NextResponse.json({ error: '請提供官方科目與有效題目（每批最多 20 題）。' }, { status: 400 });
    }
    const questions = body.questions as ClassificationQuestion[];
    if (questions.reduce((sum, q) => sum + JSON.stringify(classificationInput(q)).length, 0) > CLASSIFICATION_MAX_CHARS) {
      return NextResponse.json({ error: '分類內容過大，請縮小批次。' }, { status: 413 });
    }
    return NextResponse.json({ results: await classifyChapterBatch(body.examSubject, questions) });
  } catch { return NextResponse.json({ error: '分類資料格式錯誤；可稍後分類並繼續匯入。' }, { status: 400 }); }
}
