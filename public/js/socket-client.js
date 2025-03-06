// Add this function to handle keepalive pings
function startKeepAlive(streamId) {
  // Store the interval ID so we can clear it later
  const pingInterval = setInterval(() => {
    fetch(`/api/ping?streamId=${streamId}`)
      .then(response => response.json())
      .then(data => {
        console.log('Ping successful:', data);
      })
      .catch(error => {
        console.error('Ping failed:', error);
        // Optionally handle reconnection logic here
      });
  }, 5000); // Ping every 5 seconds
  
  // Store the interval ID in a map to clear it later
  pingIntervals.set(streamId, pingInterval);
}

function stopKeepAlive(streamId) {
  const interval = pingIntervals.get(streamId);
  if (interval) {
    clearInterval(interval);
    pingIntervals.delete(streamId);
  }
}

// Initialize a Map to store ping intervals
const pingIntervals = new Map();

// Modify the event source creation to start keepalive
function createEventSource(streamId) {
  const eventSource = new EventSource(`/scrape/open-stream?streamId=${streamId}`);
  
  // Start keepalive pings
  startKeepAlive(streamId);
  
  eventSource.addEventListener('initialData', function(event) {
    // existing code
  });
  
  // Add cleanup when the connection closes
  eventSource.addEventListener('close', function() {
    stopKeepAlive(streamId);
    eventSource.close();
  });
  
  // Add error handling
  eventSource.onerror = function(error) {
    console.error('EventSource error:', error);
    // Don't stop keepalive here - it might help recover the connection
  };
  
  return eventSource;
} 