export default defineComponent({
  async run({ steps, $ }) {
    const event = steps.trigger.event ?? {};

    function firstValue(...values) {
      return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
    }

    function headerValue(name) {
      const parsedHeaders = event.parsedHeaders ?? {};

      const directValue =
        parsedHeaders[name] ??
        parsedHeaders[name.toLowerCase()] ??
        parsedHeaders[name.toUpperCase()];

      if (typeof directValue === "string") return directValue;

      const payloadHeaders = event.payload?.headers ?? [];

      if (Array.isArray(payloadHeaders)) {
        return payloadHeaders.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
      }

      return "";
    }

    function emailAddress(value = "") {
      const match = value.match(/<([^>]+)>/);
      return (match?.[1] ?? value).trim();
    }

    function validIsoDate(value) {
      if (!value) return undefined;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    const gmailMessageId = firstValue(event.id);
    const gmailThreadId = firstValue(event.threadId);

    if (!gmailMessageId) {
      throw new Error("Missing stable Gmail message ID. Make sure the Gmail trigger has Return payload as plaintext set to FALSE.");
    }

    const fromHeader = headerValue("From");
    const toHeader = headerValue("To");
    const ccHeader = headerValue("Cc");
    const subject = headerValue("Subject") || "(no subject)";
    const dateHeader = headerValue("Date");

    const payload = {
      gmailMessageId,
      gmailThreadId,
      sourceMailbox: "job.agent@mesamachineshop.com",
      fromEmail: emailAddress(fromHeader),
      senderName: fromHeader,
      to: toHeader,
      cc: ccHeader,
      subject,
      date: validIsoDate(dateHeader) || validIsoDate(Number(event.internalDate)) || new Date().toISOString(),
      snippet: event.snippet || "",
      bodyText: event.decodedContent || event.snippet || "",
    };

    const response = await fetch("https://mesa-job-receiver.vercel.app/api/events/gmail-message-received", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mesa-webhook-secret": process.env.JOB_RECEIVER_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Mesa Job Receiver failed: ${response.status} ${responseText}`);
    }

    const result = JSON.parse(responseText);

    $.export("$summary", `Sent email package to Vercel. Airtable record: ${result.emailPackageRecordId}`);

    return result;
  },
});