import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import mammoth from "mammoth";
import sharp from "sharp";

export interface RfqDocument {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** Keep Word tables and links intact; embedded pictures go to the model too.
 * Converted HTML is model input only, never rendered in the browser.
 */
export async function rfqDocumentBlocks({ filename, mimeType, content }: RfqDocument): Promise<ContentBlockParam[]> {
  if (mimeType === "application/pdf" || /\.pdf$/i.test(filename)) {
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: content.toString("base64") }, title: filename }];
  }
  if (mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && !/\.docx$/i.test(filename)) {
    throw new Error("ניתן לקרוא מסמכי PDF או Word (.docx). מצגת PowerPoint יש לייצא ל-PDF לפני העלאה.");
  }
  const images: ContentBlockParam[] = [];
  let imageCount = 0;
  const result = await mammoth.convertToHtml({ buffer: content }, {
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async (picture) => {
      const number = ++imageCount;
      if (number > 20) throw new Error("מסמך Word מכיל יותר מדי תמונות. יש לייצא אותו ל-PDF ולהעלות שוב.");
      const data = await sharp(await picture.readAsBuffer(), { limitInputPixels: 40_000_000 })
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      if (data.length > 5_000_000) throw new Error("תמונה במסמך גדולה מדי. יש לייצא ל-PDF ולהעלות שוב.");
      images.push({type:"text",text:"Word document image " + number}, {
        type: "image", source: { type: "base64", media_type: "image/png", data: data.toString("base64") },
      });
      return { src: "embedded-image-" + number };
    }),
  });
  // Mammoth can recover from a broken image and return partial output. Do not
  // silently send that partial specification to the extractor.
  if (result.messages.some((message) => message.type === "error")) {
    throw new Error("לא ניתן לקרוא את כל תוכן מסמך Word. יש לייצא ל-PDF ולהעלות שוב.");
  }
  if (!result.value.trim() || result.value.length > 300_000) {
    throw new Error("מסמך Word ריק או ארוך מדי. יש להעלות מסמך PDF תקין.");
  }
  return [{ type: "text", text: "RFQ Word document: " + filename + "\n" + result.value }, ...images];
}
