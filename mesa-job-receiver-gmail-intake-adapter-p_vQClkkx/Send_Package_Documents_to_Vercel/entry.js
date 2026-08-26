import crypto from "node:crypto";

export default defineComponent({
  props: {
    gmail: {
      type: "app",
      app: "gmail",
    },
    google_drive: {
      type: "app",
      app: "google_drive",
    },
  },

  async run({ steps, $ }) {
    const event = steps.trigger.event ?? {};
    const emailPackageResult =
      steps.Send_Email_Package_to_Vercel?.$return_value ??
      steps.Send_email_package_to_vercel?.$return_value ??
      steps.Send_Package_to_Vercel?.$return_value ??
      steps.Send_Package_Email_to_Vercel?.$return_value;

    const emailPackageRecordId = emailPackageResult?.emailPackageRecordId;
    const driveFolderId = process.env.JOB_RECEIVER_GOOGLE_DRIVE_FOLDER_ID;

   if (!emailPackageRecordId) {
  throw new Error(
    "Missing Email Package record ID from previous step. Test the Send_Email_Package_to_Vercel step first, then test this package documents step.",
  );
}

    if (!driveFolderId) {
      throw new Error(
        "Missing Pipedream variable: JOB_RECEIVER_GOOGLE_DRIVE_FOLDER_ID",
      );
    }

    function appAccessToken(app, label) {
      const token = app?.$auth?.oauth_access_token;

      if (!token) {
        throw new Error(
          `Missing ${label} OAuth access token. Add the ${label} app connection to this Pipedream code step.`,
        );
      }

      return token;
    }

    function headerValue(name) {
      const parsedHeaders = event.parsedHeaders ?? {};

      return (
        parsedHeaders[name] ??
        parsedHeaders[name.toLowerCase()] ??
        parsedHeaders[name.toUpperCase()] ??
        ""
      );
    }

    function collectAttachments(part, results = []) {
      if (!part || typeof part !== "object") return results;

      if (part.filename && part.body?.attachmentId) {
        results.push({
          filename: part.filename,
          attachmentId: part.body.attachmentId,
          mimeType: part.mimeType,
          size: part.body.size,
        });
      }

      for (const child of part.parts ?? []) {
        collectAttachments(child, results);
      }

      return results;
    }

    function base64UrlToBuffer(value) {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
      );

      return Buffer.from(padded, "base64");
    }

    function safeDriveFilename(filename) {
      return (
        (filename || "gmail-attachment")
          .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180) || "gmail-attachment"
      );
    }

    function driveDownloadUrl(fileId) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
    }

    async function fetchGmailAttachment({
      gmailToken,
      messageId,
      attachmentId,
    }) {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        {
          headers: {
            Authorization: `Bearer ${gmailToken}`,
          },
        },
      );

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Gmail attachment download failed: ${response.status} ${responseText}`,
        );
      }

      const attachment = JSON.parse(responseText);

      if (!attachment.data) {
        throw new Error(
          `Gmail attachment ${attachmentId} did not include downloadable data.`,
        );
      }

      return base64UrlToBuffer(attachment.data);
    }

    async function uploadDriveFile({
      driveToken,
      folderId,
      filename,
      mimeType,
      fileBuffer,
    }) {
      const boundary = `mesa-job-receiver-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const metadata = {
        name: filename,
        parents: [folderId],
        mimeType: mimeType || "application/octet-stream",
      };

      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            `${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: ${metadata.mimeType}\r\n\r\n`,
        ),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const uploadResponse = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink,webContentLink",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${driveToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        },
      );

      const uploadText = await uploadResponse.text();

      if (!uploadResponse.ok) {
        throw new Error(
          `Google Drive upload failed: ${uploadResponse.status} ${uploadText}`,
        );
      }

      return JSON.parse(uploadText);
    }

    async function shareDriveFileForAirtable({ driveToken, fileId }) {
      const shouldShare =
        (process.env.JOB_RECEIVER_DRIVE_ALLOW_ANYONE_WITH_LINK ?? "TRUE")
          .toUpperCase() !== "FALSE";

      if (!shouldShare) {
        return;
      }

      const permissionResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${driveToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: "reader",
            type: "anyone",
            allowFileDiscovery: false,
          }),
        },
      );

      const permissionText = await permissionResponse.text();

      if (!permissionResponse.ok) {
        throw new Error(
          `Google Drive permission update failed: ${permissionResponse.status} ${permissionText}`,
        );
      }
    }

    const subject = headerValue("Subject") || "(no subject)";
    const gmailMessageId = event.id;
    const bodyText = event.decodedContent || event.snippet || "";
    const gmailToken = appAccessToken(this.gmail, "Gmail");
    const driveToken = appAccessToken(this.google_drive, "Google Drive");

    if (!gmailMessageId) {
      throw new Error("Missing stable Gmail message ID from trigger event.");
    }

    const documents = [];

    if (bodyText.trim()) {
      documents.push({
        documentName: `Email body - ${subject}`,
        originalFilename: "email-body.txt",
        documentText: bodyText,
        attachmentFileId: `${gmailMessageId}:email-body`,
        documentCategory: "Email Body Instructions",
        documentRole: "Supporting Customer Document",
        extractionStatus: "Not Started",
      });
    }

    const attachments = collectAttachments(event.payload);

    for (const attachment of attachments) {
      const safeFilename = safeDriveFilename(attachment.filename);
      const fileBuffer = await fetchGmailAttachment({
        gmailToken,
        messageId: gmailMessageId,
        attachmentId: attachment.attachmentId,
      });
      const attachmentHash = crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");
      const driveFile = await uploadDriveFile({
        driveToken,
        folderId: driveFolderId,
        filename: safeFilename,
        mimeType: attachment.mimeType,
        fileBuffer,
      });

      await shareDriveFileForAirtable({
        driveToken,
        fileId: driveFile.id,
      });

      documents.push({
        documentName: attachment.filename,
        originalFilename: attachment.filename,
        attachmentFileId: `${gmailMessageId}:${attachment.attachmentId}`,
        attachmentHash,
        fileUrl: driveFile.webContentLink || driveDownloadUrl(driveFile.id),
        storageObjectPath: `google-drive://folders/${driveFolderId}/files/${driveFile.id}/${safeFilename}`,
        documentCategory: "Other",
        documentRole: "Supporting Customer Document",
        extractionStatus: "Not Started",
        extractionWarnings: `Uploaded from Gmail to Google Shared Drive. MIME type: ${attachment.mimeType || "unknown"}. Gmail size: ${attachment.size || "unknown"}. Drive file: ${driveFile.webViewLink || driveFile.id}.`,
      });
    }

    if (documents.length === 0) {
      $.export(
        "$summary",
        "No email body or attachments found to send as package documents.",
      );
      return {
        ok: true,
        skipped: true,
        reason: "No documents found",
        emailPackageRecordId,
      };
    }

    const response = await fetch(
      "https://mesa-job-receiver.vercel.app/api/events/email-package-documents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mesa-webhook-secret": process.env.JOB_RECEIVER_WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          emailPackageRecordId,
          documents,
        }),
      },
    );

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Mesa Job Receiver document intake failed: ${response.status} ${responseText}`,
      );
    }

    const result = JSON.parse(responseText);

    $.export(
      "$summary",
      `Uploaded ${attachments.length} Gmail attachment(s) to Google Shared Drive and sent ${documents.length} package document(s) to Vercel for Email Package ${emailPackageRecordId}.`,
    );

    return result;
  },
});