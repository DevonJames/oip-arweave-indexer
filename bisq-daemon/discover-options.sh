#!/bin/bash

# Script to discover valid command line options for Bisq daemon

echo "Attempting to discover valid Bisq daemon options..."

# Try different help formats
echo "Trying --help option:"
./bisq-daemon --help > bisq_help.txt 2>&1
cat bisq_help.txt

echo "Trying --helpFormat=options option (if available):"
./bisq-daemon --helpFormat=options > bisq_options.txt 2>&1
cat bisq_options.txt

echo "Results saved to bisq_help.txt and bisq_options.txt" 