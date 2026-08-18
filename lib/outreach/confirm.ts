/**
 * The phrase the operator types before the first real send.
 *
 * Its own module with no imports so both the server action and the client form
 * can use it - the batch sender pulls in the database and the Gmail client, and
 * neither belongs in a browser bundle.
 */
export const CAMPAIGN_CONFIRMATION = "שלח לספקים";
