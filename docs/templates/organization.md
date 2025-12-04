{
    "audio": {
        "org_handle": "string",
        "index_org_handle": 0,
        "org_public_key": "string",
        "index_org_public_key": 1,
        "admin_public_keys": "repeated string",
        "index_admin_public_keys": 2,
        "membership_policy": "enum",
        "index_membership_policy": 3,
        "membership_policyValues": [
            {
                "code": "invite-only",
                "name": "Invite Only"
            },
            {
                "code": "app-user-auto",
                "name": "Auto-Enroll App Users"
            },
            {
                "code": "token-gated",
                "name": "Token-Gated Membership"
            },
            {
                "code": "open-join",
                "name": "Open Join"
            }
        ],
        "metadata": "string",
        "index_metadata": 4
    }
}