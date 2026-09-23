import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { Messages } from "@anthropic-ai/sdk/resources/messages";
import sharp from "sharp";
import { rfqDocumentBlocks } from "../lib/rfq/document";
import { parseRfq } from "../lib/rfq/parse";
const require = createRequire(import.meta.url);
const JSZip = require(require.resolve("jszip", { paths: [require.resolve("mammoth")] }));
const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
async function fixture() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hooded Hair Dryer</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>500 pcs</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$22.25 EXW</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  return zip.generateAsync({type:"nodebuffer"});
}
test("DOCX pricing table reaches the RFQ model, PDF still works, malformed files fail before billing", async () => {
  const original = Messages.prototype.stream;
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-only";
  let captured: any;
  const extraction = { product_name: "Dryer", version: null, period: null, currency: "USD", quantity_tiers: [500], items: [], shared_requirements: [], validation_issues: [] };
  Messages.prototype.stream = ((request: any) => {
    captured = request;
    return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{type:"text", text:JSON.stringify(extraction)}], usage: {} }) };
  }) as any;
  try {
    await parseRfq({filename:"rfq.docx",mimeType,content:await fixture()});
    const texts = captured.messages[0].content.filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("\n");
    assert.match(texts, /Hooded Hair Dryer/);
    assert.match(texts, /<table>/);
    assert.match(texts, /500 pcs/);
    assert.match(texts, /22.25 EXW/);
    await parseRfq({filename:"rfq.pdf",mimeType:"application/pdf",content:Buffer.from("%PDF-1.7")});
    assert.equal(captured.messages[0].content[0].type,"document");
    captured = null;
    await assert.rejects(parseRfq({filename:"broken.docx",mimeType,content:Buffer.from("broken")}));
    assert.equal(captured,null);
    await assert.rejects(parseRfq({filename:"rfq.pptx",mimeType:"application/octet-stream",content:Buffer.from("bad")}));
  } finally {
    Messages.prototype.stream = original;
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key;
  }
});

test("Word embedded product images are preserved; broken images block incomplete extraction", async () => {
  const zip = await JSZip.loadAsync(await fixture());
  const pic = '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="Product photo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const doc = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", doc.replace("</w:body>",pic+"</w:body>"));
  zip.file("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/product.png"/></Relationships>');
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>');
  zip.file("word/media/product.png", await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer());
  const blocks = await rfqDocumentBlocks({filename:"photo.docx",mimeType,content:await zip.generateAsync({type:"nodebuffer"})});
  assert.equal(blocks.filter(b=>b.type==="image").length,1);
  zip.file("word/media/product.png",Buffer.from("corrupt image"));
  await assert.rejects(rfqDocumentBlocks({filename:"photo.docx",mimeType,content:await zip.generateAsync({type:"nodebuffer"})}));
});
