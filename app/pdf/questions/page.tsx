import PDFQuestionsClient from "./PDFQuestionsClient";

type PageProps = {
  searchParams: Promise<{
    setId?: string;
  }>;
};

export default async function PDFQuestionsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  return (
    <PDFQuestionsClient
      questionSetId={params.setId ?? ""}
    />
  );
}