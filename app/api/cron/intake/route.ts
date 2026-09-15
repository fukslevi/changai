import { NextResponse } from "next/server";
import { importNewProducts } from "@/lib/intake/import";
import { authorised } from "../auth";

/**
 * Once a day: read the product intake sheet, and turn every row nobody has
 * seen yet into a screening project. Cheap and global, so it gets its own
 * schedule rather than sitting at the end of a longer cycle that might run
 * out of time before reaching it.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await importNewProducts();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
