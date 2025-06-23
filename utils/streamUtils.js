/**
 * Send event to all clients for a given dialogue ID
 * @param {string} dialogueId - The dialogue ID
 * @param {string} event - The event name
 * @param {Object} data - The event data
 */
function sendEventToAll(dialogueId, event, data) {
  console.log(`Sending ${event} event to clients for dialogueId: ${dialogueId}`);
  
  if (!ongoingStreams.has(dialogueId)) {
    console.log(`No clients found for id: ${dialogueId}`);
    return;
  }
  
  const stream = ongoingStreams.get(dialogueId);
  for (const client of stream.clients) {
    const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    client.write(eventData);
  }
} 