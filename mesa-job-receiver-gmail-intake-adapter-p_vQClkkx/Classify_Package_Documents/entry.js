export default defineComponent({
  async run({ steps, $ }) {
    const priorResults = Object.values(steps)
      .map((step) => step?.$return_value)
      .filter(Boolean);

    const documentIntakeResult = priorResults.find(
      (result) =>
        Array.isArray(result.packageDocumentRecordIds) &&
        result.packageDocumentRecordIds.length > 0 &&
        result.emailPackageRecordId
    );

    if (!documentIntakeResult) {
      throw new Error("Missing Package Document result from the previous Pipedream step.");
    }

    const payload = {
      emailPackageRecordId: documentIntakeResult.emailPackageRecordId,
      packageDocumentRecordIds: documentIntakeResult.packageDocumentRecordIds,
    };

    const response = await fetch("https://mesa-job-receiver.vercel.app/api/workflows/classify-documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mesa-webhook-secret": process.env.JOB_RECEIVER_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Mesa Job Receiver classification failed: ${response.status} ${responseText}`);
    }

    const result = JSON.parse(responseText);

    $.export(
      "$summary",
      `Classified ${result.classifiedDocuments.length} package document(s) for Email Package ${result.emailPackageRecordId}.`
    );

    return result;
  },
});