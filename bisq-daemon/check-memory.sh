#!/bin/bash

# Memory monitoring script
echo "Checking Java process memory usage..."

# Get PIDs of Java processes
java_pids=$(pgrep java)

if [ -z "$java_pids" ]; then
  echo "No Java processes found"
  exit 1
fi

echo "Java processes found: $java_pids"

# Print memory info for each Java process
for pid in $java_pids; do
  echo "Memory usage for Java process $pid:"
  ps -o pid,rss,vsz,cmd -p $pid
  
  if command -v jstat &> /dev/null; then
    echo "JVM memory statistics:"
    jstat -gc $pid
  fi
  
  if command -v jcmd &> /dev/null; then
    echo "JVM heap summary:"
    jcmd $pid GC.heap_info || true
  fi
done

# Print system memory information
echo "System memory information:"
free -h

# Print available disk space
echo "Disk usage:"
df -h 