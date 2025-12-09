#!/bin/bash

# Calendar Token System Test Script
# Tests the new scoped JWT calendar token functionality

set -e  # Exit on error

# Configuration
API_BASE="${API_BASE:-http://localhost:8765}"
TEST_EMAIL="${TEST_EMAIL:-test@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-testpassword123}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_test() {
    echo -e "${YELLOW}TEST: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ PASS: $1${NC}"
    ((TESTS_PASSED++))
}

print_fail() {
    echo -e "${RED}❌ FAIL: $1${NC}"
    ((TESTS_FAILED++))
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Cleanup function
cleanup() {
    rm -f /tmp/full_jwt.txt /tmp/calendar_jwt.txt /tmp/response.json
}

trap cleanup EXIT

# Test 1: User Login
test_login() {
    print_header "Test 1: User Login (Get Full JWT)"
    print_test "Logging in with email: $TEST_EMAIL"
    
    response=$(curl -s -X POST "$API_BASE/api/user/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")
    
    echo "$response" > /tmp/response.json
    
    # Check if login was successful
    success=$(echo "$response" | jq -r '.success')
    if [ "$success" = "true" ]; then
        token=$(echo "$response" | jq -r '.token')
        echo "$token" > /tmp/full_jwt.txt
        print_success "Login successful, full JWT obtained"
        print_info "JWT: ${token:0:50}..."
        return 0
    else
        error=$(echo "$response" | jq -r '.error // .message')
        print_fail "Login failed: $error"
        echo "Response: $response"
        return 1
    fi
}

# Test 2: Generate Calendar Token
test_generate_calendar_token() {
    print_header "Test 2: Generate Calendar Token"
    print_test "Generating calendar-scoped JWT"
    
    if [ ! -f /tmp/full_jwt.txt ]; then
        print_fail "No full JWT found. Run login test first."
        return 1
    fi
    
    full_jwt=$(cat /tmp/full_jwt.txt)
    
    response=$(curl -s -X POST "$API_BASE/api/user/generate-calendar-token" \
        -H "Authorization: Bearer $full_jwt" \
        -H "Content-Type: application/json")
    
    echo "$response" > /tmp/response.json
    
    # Check if generation was successful
    success=$(echo "$response" | jq -r '.success')
    if [ "$success" = "true" ]; then
        calendar_jwt=$(echo "$response" | jq -r '.calendarJWT')
        token_hash=$(echo "$response" | jq -r '.tokenHash')
        scope=$(echo "$response" | jq -r '.scope')
        expires_in=$(echo "$response" | jq -r '.expiresIn')
        
        echo "$calendar_jwt" > /tmp/calendar_jwt.txt
        
        print_success "Calendar token generated successfully"
        print_info "Scope: $scope"
        print_info "Expires in: $expires_in seconds ($(($expires_in / 86400)) days)"
        print_info "Token hash: ${token_hash:0:32}..."
        print_info "Calendar JWT: ${calendar_jwt:0:50}..."
        
        # Verify scope is calendar-read-only
        if [ "$scope" = "calendar-read-only" ]; then
            print_success "Token has correct scope: calendar-read-only"
        else
            print_fail "Token has incorrect scope: $scope"
            return 1
        fi
        
        return 0
    else
        error=$(echo "$response" | jq -r '.error // .message')
        print_fail "Calendar token generation failed: $error"
        echo "Response: $response"
        return 1
    fi
}

# Test 3: Access Allowed Record Type (workoutSchedule)
test_access_workouts() {
    print_header "Test 3: Access Allowed Record Type (workoutSchedule)"
    print_test "Fetching workout records with calendar token"
    
    if [ ! -f /tmp/calendar_jwt.txt ]; then
        print_fail "No calendar JWT found. Run token generation test first."
        return 1
    fi
    
    calendar_jwt=$(cat /tmp/calendar_jwt.txt)
    
    response=$(curl -s -X GET "$API_BASE/api/records?recordType=workoutSchedule&source=gun&limit=5" \
        -H "Authorization: Bearer $calendar_jwt")
    
    echo "$response" > /tmp/response.json
    
    # Check for error
    error=$(echo "$response" | jq -r '.error // empty')
    if [ -n "$error" ]; then
        print_fail "Access to workoutSchedule failed: $error"
        echo "Response: $response"
        return 1
    fi
    
    # Check auth information
    scope=$(echo "$response" | jq -r '.auth.user.scope')
    token_type=$(echo "$response" | jq -r '.auth.user.tokenType')
    
    if [ "$scope" = "calendar-read-only" ] && [ "$token_type" = "calendar" ]; then
        print_success "Successfully accessed workoutSchedule records"
        print_info "Auth scope: $scope"
        print_info "Token type: $token_type"
        
        # Show record count
        total=$(echo "$response" | jq -r '.total // 0')
        print_info "Found $total workout records"
        return 0
    else
        print_fail "Auth info incorrect. Scope: $scope, Type: $token_type"
        return 1
    fi
}

# Test 4: Access Allowed Record Type (mealPlan)
test_access_meals() {
    print_header "Test 4: Access Allowed Record Type (mealPlan)"
    print_test "Fetching meal plan records with calendar token"
    
    if [ ! -f /tmp/calendar_jwt.txt ]; then
        print_fail "No calendar JWT found. Run token generation test first."
        return 1
    fi
    
    calendar_jwt=$(cat /tmp/calendar_jwt.txt)
    
    response=$(curl -s -X GET "$API_BASE/api/records?recordType=mealPlan&source=gun&limit=5" \
        -H "Authorization: Bearer $calendar_jwt")
    
    echo "$response" > /tmp/response.json
    
    # Check for error
    error=$(echo "$response" | jq -r '.error // empty')
    if [ -n "$error" ]; then
        print_fail "Access to mealPlan failed: $error"
        echo "Response: $response"
        return 1
    fi
    
    print_success "Successfully accessed mealPlan records"
    
    # Show record count
    total=$(echo "$response" | jq -r '.total // 0')
    print_info "Found $total meal plan records"
    return 0
}

# Test 5: Block Unauthorized Record Type
test_block_unauthorized_type() {
    print_header "Test 5: Block Unauthorized Record Type (userFitnessProfile)"
    print_test "Attempting to access userFitnessProfile (should be blocked)"
    
    if [ ! -f /tmp/calendar_jwt.txt ]; then
        print_fail "No calendar JWT found. Run token generation test first."
        return 1
    fi
    
    calendar_jwt=$(cat /tmp/calendar_jwt.txt)
    
    response=$(curl -s -X GET "$API_BASE/api/records?recordType=userFitnessProfile&source=gun" \
        -H "Authorization: Bearer $calendar_jwt")
    
    echo "$response" > /tmp/response.json
    
    # Check if request was blocked (should return 403)
    success=$(echo "$response" | jq -r '.success')
    error=$(echo "$response" | jq -r '.error')
    message=$(echo "$response" | jq -r '.message')
    
    if [ "$success" = "false" ] && [ "$error" = "Forbidden" ]; then
        print_success "Correctly blocked access to userFitnessProfile"
        print_info "Error message: $message"
        return 0
    else
        print_fail "Failed to block unauthorized record type"
        echo "Response: $response"
        return 1
    fi
}

# Test 6: Block Write Operations (POST)
test_block_write_operations() {
    print_header "Test 6: Block Write Operations (POST)"
    print_test "Attempting to create a record (should be blocked)"
    
    if [ ! -f /tmp/calendar_jwt.txt ]; then
        print_fail "No calendar JWT found. Run token generation test first."
        return 1
    fi
    
    calendar_jwt=$(cat /tmp/calendar_jwt.txt)
    
    response=$(curl -s -X POST "$API_BASE/api/records/newRecord?recordType=workoutSchedule" \
        -H "Authorization: Bearer $calendar_jwt" \
        -H "Content-Type: application/json" \
        -d '{"basic":{"name":"Test Workout"}}')
    
    echo "$response" > /tmp/response.json
    
    # Check if request was blocked (should return 403)
    success=$(echo "$response" | jq -r '.success')
    error=$(echo "$response" | jq -r '.error')
    message=$(echo "$response" | jq -r '.message')
    
    if [ "$success" = "false" ] && [ "$error" = "Forbidden" ]; then
        print_success "Correctly blocked POST operation"
        print_info "Error message: $message"
        return 0
    else
        print_fail "Failed to block write operation"
        echo "Response: $response"
        return 1
    fi
}

# Test 7: Verify Full JWT Still Works
test_full_jwt_access() {
    print_header "Test 7: Verify Full JWT Still Works"
    print_test "Accessing userFitnessProfile with full JWT (should succeed)"
    
    if [ ! -f /tmp/full_jwt.txt ]; then
        print_fail "No full JWT found. Run login test first."
        return 1
    fi
    
    full_jwt=$(cat /tmp/full_jwt.txt)
    
    response=$(curl -s -X GET "$API_BASE/api/records?recordType=userFitnessProfile&source=gun&limit=1" \
        -H "Authorization: Bearer $full_jwt")
    
    echo "$response" > /tmp/response.json
    
    # Check for error
    error=$(echo "$response" | jq -r '.error // empty')
    if [ -n "$error" ]; then
        print_fail "Full JWT access failed: $error"
        echo "Response: $response"
        return 1
    fi
    
    # Check auth scope (should be 'full')
    scope=$(echo "$response" | jq -r '.auth.user.scope')
    
    if [ "$scope" = "full" ]; then
        print_success "Full JWT works correctly with full scope"
        print_info "Auth scope: $scope"
        return 0
    else
        print_fail "Full JWT has incorrect scope: $scope"
        return 1
    fi
}

# Test 8: Token Revocation
test_token_revocation() {
    print_header "Test 8: Token Revocation"
    print_test "Revoking calendar token"
    
    if [ ! -f /tmp/full_jwt.txt ]; then
        print_fail "No full JWT found. Run login test first."
        return 1
    fi
    
    full_jwt=$(cat /tmp/full_jwt.txt)
    
    response=$(curl -s -X POST "$API_BASE/api/user/revoke-calendar-token" \
        -H "Authorization: Bearer $full_jwt" \
        -H "Content-Type: application/json")
    
    echo "$response" > /tmp/response.json
    
    # Check if revocation was successful
    success=$(echo "$response" | jq -r '.success')
    message=$(echo "$response" | jq -r '.message')
    
    if [ "$success" = "true" ]; then
        print_success "Calendar token revoked successfully"
        print_info "Message: $message"
        print_info "Note: Existing JWTs still valid until expiration (requires active revocation to fully block)"
        return 0
    else
        error=$(echo "$response" | jq -r '.error')
        print_fail "Token revocation failed: $error"
        echo "Response: $response"
        return 1
    fi
}

# Main test execution
main() {
    print_header "Calendar Token System Test Suite"
    print_info "Testing API at: $API_BASE"
    print_info "Test user: $TEST_EMAIL"
    echo ""
    
    # Run all tests
    test_login || true
    test_generate_calendar_token || true
    test_access_workouts || true
    test_access_meals || true
    test_block_unauthorized_type || true
    test_block_write_operations || true
    test_full_jwt_access || true
    test_token_revocation || true
    
    # Print summary
    print_header "Test Summary"
    echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
    echo ""
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}🎉 All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}⚠️  Some tests failed. Review output above.${NC}"
        exit 1
    fi
}

# Run main function
main

