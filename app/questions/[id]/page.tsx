import { notFound } from 'next/navigation';
import { getPublicQuestion, questionShareUrl } from '@/lib/public-questions';
import { formatExamYear } from '@/lib/exam-year';
import QuestionDetail from './QuestionDetail';
type Props = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: Props) {
  const question = await getPublicQuestion((await params).id);
  if (!question) return { title: '找不到題目｜VetExam', robots: { index: false, follow: false } };
  const url = questionShareUrl(question.id);
  return { title: `${formatExamYear(question.examYear)}獸醫師國考｜${question.subject}第 ${question.questionNumber} 題｜VetExam`,
    description: question.question.slice(0, 160), ...(url ? { alternates: { canonical: url } } : {}) };
}
export default async function QuestionPage({ params }: Props) {
  const question = await getPublicQuestion((await params).id);
  if (!question) notFound();
  return <QuestionDetail key={question.id} question={question} shareUrl={questionShareUrl(question.id)} />;
}
