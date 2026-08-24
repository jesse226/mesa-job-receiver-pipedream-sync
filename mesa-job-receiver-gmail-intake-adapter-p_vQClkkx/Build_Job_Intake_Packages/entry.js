export default defineComponent({
  async run({ steps, $ }) {
    const priorResults = Object.values(steps)
      .map((step) => step?.$return_value)
      .filter(Boolean);

    const classificationResult = priorResults.find(
      (result) =>
        Array.isArray(result.classifiedDocuments) &&
        result.classifiedDocuments.length > 0 &&
        result.emailPackageRecordId
    );

    const documentIntakeResult = priorResults.find(
      (result) =>
        Array.isArray(result.packageDocumentRecordIds) &&
        result.packageDocumentRecordIds.length > 0 &&
        result.emailPackageRecordId
    );

    if (!classificationResult || !documentIntakeResult) {
      throw new Error("Missing classification or document intake result from prior Pipedream steps.");
    }

    const payload = {
      emailPackageRecordId: classificationResult.emailPackageRecordId,
      packageDocumentRecordIds: documentIntakeResult.packageDocumentRecordIds,
    };

    const response = await fetch("https://mesa-job-receiver.vercel.app/api/workflows/build-job-intake-packages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mesa-webhook-secret": process.env.JOB_RECEIVER_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Mesa Job Receiver job intake package build failed: ${response.status} ${responseText}`);
    }

    const result = JSON.parse(responseText);

    $.export(
      "$summary",
      `Built ${result.count} Job Intake Package record(s) for Email Package ${result.emailPackageRecordId}.`
    );

    return result;
  },
});