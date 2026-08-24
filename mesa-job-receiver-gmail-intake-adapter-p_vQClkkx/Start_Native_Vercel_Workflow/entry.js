export default defineComponent({
  async run({ steps, $ }) {
    const documentIntakeResult =
      steps.Send_Package_Documents_to_Vercel?.$return_value ??
      steps.Send_email_package_to_vercel?.$return_value;

    if (!documentIntakeResult?.emailPackageRecordId) {
      throw new Error("Missing Email Package record ID from prior Pipedream step.");
    }

    const response = await fetch("https://mesa-job-receiver.vercel.app/api/workflows/start-email-package-processing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mesa-webhook-secret": process.env.JOB_RECEIVER_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        emailPackageRecordId: documentIntakeResult.emailPackageRecordId,
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Mesa Job Receiver native workflow start failed: ${response.status} ${responseText}`);
    }

    const result = JSON.parse(responseText);

    $.export(
      "$summary",
      `Started native Vercel workflow ${result.vercelWorkflowRunId} for Email Package ${result.emailPackageRecordId}.`
    );

    return result;
  },
});