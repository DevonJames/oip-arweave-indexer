{
"musicTrack": {
"trackTitleVersion": "string",
"index_trackTitleVersion": 0,
"discNumber": "uint32",
"index_discNumber": 1,
"trackArtistDisplay": "string",
"index_trackArtistDisplay": 2,
"primaryArtistItems": "repeated dref",
"index_primaryArtistItems": 3,
"featuredArtistItems": "repeated dref",
"index_featuredArtistItems": 4,
"remixerItems": "repeated dref",
"index_remixerItems": 5,
"explicitStatus": "enum",
"explicitStatusValues": [
{
"code": "none",
"name": "Not Explicit"
},
{
"code": "explicit",
"name": "Explicit"
},
{
"code": "clean",
"name": "Clean / Edited"
}
],
"index_explicitStatus": 6,
"isLiveVersion": "bool",
"index_isLiveVersion": 7,
"isCover": "bool",
"index_isCover": 8,
"isPublicDomain": "bool",
"index_isPublicDomain": 9,
"isInstrumental": "bool",
"index_isInstrumental": 10,
"languageOfLyrics": "string",
"index_languageOfLyrics": 11
}
}

{
"musicTrackLyrics": {
"hasLyrics": "bool",
"index_hasLyrics": 0,
"lyricsLanguage": "string",
"index_lyricsLanguage": 1,
"lyricsText": "dref",
"index_lyricsText": 2,
"lyricsExplicit": "bool",
"index_lyricsExplicit": 3,
"lyricsSyncedFormat": "enum",
"lyricsSyncedFormatValues": [
{
"code": "none",
"name": "No Synced Lyrics"
},
{
"code": "lrc",
"name": "LRC"
},
{
"code": "ttml",
"name": "TTML"
},
{
"code": "other",
"name": "Other"
}
],
"index_lyricsSyncedFormat": 4,
"lyricsSyncedPayload": "string",
"index_lyricsSyncedPayload": 5,
"lyricsTranslationItems": "repeated dref",
"index_lyricsTranslationItems": 6,
"lyricsSource": "enum",
"lyricsSourceValues": [
{
"code": "self",
"name": "Self-Provided"
},
{
"code": "publisher",
"name": "Publisher-Provided"
},
{
"code": "musixmatch",
"name": "Musixmatch"
},
{
"code": "lyricfind",
"name": "LyricFind"
},
{
"code": "other",
"name": "Other"
}
],
"index_lyricsSource": 7
}
}

{
"musicTrackLocalization": {
"localizedTitleLanguageItems": "repeated string",
"index_localizedTitleLanguageItems": 0,
"localizedTitleItems": "repeated string",
"index_localizedTitleItems": 1,
"localizedArtistLanguageItems": "repeated string",
"index_localizedArtistLanguageItems": 2,
"localizedArtistDisplayItems": "repeated string",
"index_localizedArtistDisplayItems": 3
}
}

{
"musicTrackCreditRefs": {
"creditItems": "repeated dref",
"index_creditItems": 0
}
}

{
"musicTrackWorkRefs": {
"workItems": "repeated dref",
"index_workItems": 0
}
}

{
"musicTrackDealRefs": {
"dealItems": "repeated dref",
"index_dealItems": 0
}
}

{
"musicRelease": {
"releaseType": "enum",
"releaseTypeValues": [
{
"code": "single",
"name": "Single"
},
{
"code": "ep",
"name": "EP"
},
{
"code": "album",
"name": "Album"
},
{
"code": "compilation",
"name": "Compilation"
},
{
"code": "soundtrack",
"name": "Soundtrack"
},
{
"code": "live",
"name": "Live"
},
{
"code": "remix",
"name": "Remix"
},
{
"code": "other",
"name": "Other"
}
],
"index_releaseType": 0,
"releaseTitleVersion": "string",
"index_releaseTitleVersion": 1,
"displayArtistName": "string",
"index_displayArtistName": 2,
"primaryArtistItems": "repeated dref",
"index_primaryArtistItems": 3,
"featuredArtistItems": "repeated dref",
"index_featuredArtistItems": 4,
"isVariousArtists": "bool",
"index_isVariousArtists": 5,
"isCompilation": "bool",
"index_isCompilation": 6,
"labelName": "string",
"index_labelName": 7,
"labelRef": "dref",
"index_labelRef": 8,
"catalogNumber": "string",
"index_catalogNumber": 9,
"upcEanJan": "string",
"index_upcEanJan": 10,
"explicitStatus": "enum",
"explicitStatusValues": [
{
"code": "none",
"name": "Not Explicit"
},
{
"code": "explicit",
"name": "Explicit"
},
{
"code": "clean",
"name": "Clean / Edited"
}
],
"index_explicitStatus": 11,
"primaryLanguage": "string",
"index_primaryLanguage": 12,
"primaryGenre": "string",
"index_primaryGenre": 13,
"secondaryGenre": "string",
"index_secondaryGenre": 14,
"subGenre": "string",
"index_subGenre": 15
}
}

{
"musicReleaseDates": {
"releaseDate": "long",
"index_releaseDate": 0,
"originalReleaseDate": "long",
"index_originalReleaseDate": 1,
"preOrderStartDate": "long",
"index_preOrderStartDate": 2,
"salesStartDate": "long",
"index_salesStartDate": 3,
"releaseAsap": "bool",
"index_releaseAsap": 4
}
}

{
"musicReleaseAvailability": {
"territoryMode": "enum",
"territoryModeValues": [
{
"code": "worldwide",
"name": "Worldwide"
},
{
"code": "include",
"name": "Include Only Listed Territories"
},
{
"code": "exclude",
"name": "Exclude Listed Territories"
}
],
"index_territoryMode": 0,
"includedTerritories": "repeated string",
"index_includedTerritories": 1,
"excludedTerritories": "repeated string",
"index_excludedTerritories": 2,
"defaultStoreMode": "enum",
"defaultStoreModeValues": [
{
"code": "all",
"name": "All Stores"
},
{
"code": "selected",
"name": "Selected Stores Only"
}
],
"index_defaultStoreMode": 3,
"defaultStoreIds": "repeated string",
"index_defaultStoreIds": 4
}
}

{
"musicReleaseRights": {
"copyrightYear": "uint32",
"index_copyrightYear": 0,
"copyrightOwner": "string",
"index_copyrightOwner": 1,
"phonographicYear": "uint32",
"index_phonographicYear": 2,
"phonographicOwner": "string",
"index_phonographicOwner": 3,
"labelLine": "string",
"index_labelLine": 4
}
}

{
"musicReleaseTracks": {
"trackRecordingItems": "repeated dref",
"index_trackRecordingItems": 0,
"trackDiscNumberItems": "repeated uint32",
"index_trackDiscNumberItems": 1,
"trackTrackNumberItems": "repeated uint32",
"index_trackTrackNumberItems": 2,
"trackIsBonusTrackItems": "repeated bool",
"index_trackIsBonusTrackItems": 3
}
}

{
"musicReleaseCreditRefs": {
"creditItems": "repeated dref",
"index_creditItems": 0
}
}

{
"musicReleaseDealRefs": {
"dealItems": "repeated dref",
"index_dealItems": 0
}
}

{
"musicParty": {
"partyType": "enum",
"partyTypeValues": [
{
"code": "person",
"name": "Person"
},
{
"code": "group",
"name": "Group / Band"
},
{
"code": "label",
"name": "Label"
},
{
"code": "publisher",
"name": "Publisher"
},
{
"code": "other",
"name": "Other"
}
],
"index_partyType": 0,
"roleHints": "repeated string",
"index_roleHints": 1,
"legalName": "string",
"index_legalName": 2,
"countryOfResidence": "string",
"index_countryOfResidence": 3
}
}

{
"musicPartyIndustryIds": {
"isni": "string",
"index_isni": 0,
"ipiCae": "string",
"index_ipiCae": 1,
"ipn": "string",
"index_ipn": 2,
"proName": "string",
"index_proName": 3,
"proMemberId": "string",
"index_proMemberId": 4
}
}

{
"musicPartyDSPProfiles": {
"spotifyArtistUri": "string",
"index_spotifyArtistUri": 0,
"spotifyArtistUrl": "string",
"index_spotifyArtistUrl": 1,
"appleMusicArtistId": "string",
"index_appleMusicArtistId": 2,
"appleMusicArtistUrl": "string",
"index_appleMusicArtistUrl": 3,
"youtubeMusicChannelId": "string",
"index_youtubeMusicChannelId": 4,
"youtubeMusicArtistUrl": "string",
"index_youtubeMusicArtistUrl": 5,
"amazonMusicArtistId": "string",
"index_amazonMusicArtistId": 6,
"amazonMusicArtistUrl": "string",
"index_amazonMusicArtistUrl": 7,
"profileCreateMode": "enum",
"profileCreateModeValues": [
{
"code": "use-existing",
"name": "Use Existing Profiles"
},
{
"code": "create-new",
"name": "Create New Profiles"
}
],
"index_profileCreateMode": 8
}
}

{
"musicCredit": {
"scopeType": "enum",
"scopeTypeValues": [
{
"code": "track",
"name": "Track"
},
{
"code": "release",
"name": "Release"
}
],
"index_scopeType": 0,
"subjectRef": "dref",
"index_subjectRef": 1,
"partyRef": "dref",
"index_partyRef": 2,
"creditedNameOverride": "string",
"index_creditedNameOverride": 3,
"role": "enum",
"roleValues": [
{
"code": "perf",
"name": "Performer"
},
{
"code": "voc_lead",
"name": "Vocals (Lead)"
},
{
"code": "voc_bg",
"name": "Vocals (Background)"
},
{
"code": "rap",
"name": "Rapper"
},
{
"code": "spk",
"name": "Spoken Word"
},
{
"code": "gtr",
"name": "Guitar"
},
{
"code": "bass",
"name": "Bass"
},
{
"code": "drm",
"name": "Drums"
},
{
"code": "key",
"name": "Keys"
},
{
"code": "str",
"name": "Strings"
},
{
"code": "brs",
"name": "Brass"
},
{
"code": "wdw",
"name": "Woodwinds"
},
{
"code": "syn",
"name": "Synths / Programming"
},
{
"code": "orch",
"name": "Orchestra"
},
{
"code": "cond",
"name": "Conductor"
},
{
"code": "ens",
"name": "Ensemble / Choir"
},
{
"code": "cmp",
"name": "Composer"
},
{
"code": "lyr",
"name": "Lyricist"
},
{
"code": "arr",
"name": "Arranger"
},
{
"code": "adp",
"name": "Adapter / Translator"
},
{
"code": "prod",
"name": "Producer"
},
{
"code": "cprd",
"name": "Co-Producer"
},
{
"code": "eprd",
"name": "Executive Producer"
},
{
"code": "reng",
"name": "Recording Engineer"
},
{
"code": "meng",
"name": "Mixing Engineer"
},
{
"code": "mst",
"name": "Mastering Engineer"
},
{
"code": "aeng",
"name": "Assistant Engineer"
},
{
"code": "vprod",
"name": "Vocal Producer"
},
{
"code": "veng",
"name": "Vocal Engineer"
},
{
"code": "feat",
"name": "Featuring Artist"
},
{
"code": "with",
"name": "With Artist"
},
{
"code": "rmx",
"name": "Remixer"
},
{
"code": "djm",
"name": "DJ Mixer"
},
{
"code": "art",
"name": "Cover Art Artist"
},
{
"code": "photo",
"name": "Photographer"
},
{
"code": "gdes",
"name": "Graphic Designer"
},
{
"code": "ln",
"name": "Liner Notes Author"
},
{
"code": "oth",
"name": "Other"
}
],
"index_role": 4,
"roleDetail": "string",
"index_roleDetail": 5,
"instrument": "string",
"index_instrument": 6,
"isPrimary": "bool",
"index_isPrimary": 7,
"sortOrder": "uint32",
"index_sortOrder": 8,
"displayOnDSP": "bool",
"index_displayOnDSP": 9,
"notes": "string",
"index_notes": 10
}
}

{
"musicWork": {
"workTitleVersion": "string",
"index_workTitleVersion": 0,
"iswc": "string",
"index_iswc": 1,
"territoryOfRights": "repeated string",
"index_territoryOfRights": 2,
"publicDomainClaim": "bool",
"index_publicDomainClaim": 3,
"publicDomainEvidence": "string",
"index_publicDomainEvidence": 4
}
}

{
"musicWorkShare": {
"workRef": "dref",
"index_workRef": 0,
"writerPartyRef": "dref",
"index_writerPartyRef": 1,
"contributionType": "enum",
"contributionTypeValues": [
{
"code": "music",
"name": "Music"
},
{
"code": "lyrics",
"name": "Lyrics"
},
{
"code": "both",
"name": "Both"
}
],
"index_contributionType": 2,
"ownershipSharePercent": "float",
"index_ownershipSharePercent": 3,
"publisherPartyRef": "dref",
"index_publisherPartyRef": 4,
"publisherNameOverride": "string",
"index_publisherNameOverride": 5,
"proName": "string",
"index_proName": 6,
"proMemberId": "string",
"index_proMemberId": 7,
"ipiCae": "string",
"index_ipiCae": 8
}
}

{
"musicDeal": {
"subjectType": "enum",
"subjectTypeValues": [
{
"code": "release",
"name": "Release"
},
{
"code": "track",
"name": "Track"
}
],
"index_subjectType": 0,
"subjectRef": "dref",
"index_subjectRef": 1,
"selectedServices": "repeated string",
"index_selectedServices": 2,
"includedTerritories": "repeated string",
"index_includedTerritories": 3,
"excludedTerritories": "repeated string",
"index_excludedTerritories": 4,
"dealStartDatetime": "long",
"index_dealStartDatetime": 5,
"dealEndDatetime": "long",
"index_dealEndDatetime": 6,
"monetizationTypes": "repeated string",
"index_monetizationTypes": 7,
"pricingTier": "string",
"index_pricingTier": 8,
"takedownPolicy": "string",
"index_takedownPolicy": 9,
"requestedTakedownDate": "long",
"index_requestedTakedownDate": 10,
"previewStartTimeSec": "uint32",
"index_previewStartTimeSec": 11,
"releaseSyncTime": "long",
"index_releaseSyncTime": 12
}
}

{
"playlist": {
"playlistType": "enum",
"playlistTypeValues": [
{
"code": "user",
"name": "User Playlist"
},
{
"code": "editorial",
"name": "Editorial Playlist"
},
{
"code": "label",
"name": "Label / Branded Playlist"
},
{
"code": "algorithm",
"name": "Algorithmic Playlist"
}
],
"index_playlistType": 0,
"ownerPartyRef": "dref",
"index_ownerPartyRef": 1,
"isPublic": "bool",
"index_isPublic": 2,
"isCollaborative": "bool",
"index_isCollaborative": 3,
"itemTrackRefItems": "repeated dref",
"index_itemTrackRefItems": 4,
"itemPositionItems": "repeated uint32",
"index_itemPositionItems": 5,
"itemAddedAtItems": "repeated long",
"index_itemAddedAtItems": 6,
"itemAddedByPartyRefItems": "repeated dref",
"index_itemAddedByPartyRefItems": 7,
"itemNoteItems": "repeated string",
"index_itemNoteItems": 8
}
}

{
"artworkFlags": {
"artworkRightsConfirmed": "bool",
"index_artworkRightsConfirmed": 0,
"artworkSource": "enum",
"artworkSourceValues": [
{
"code": "self",
"name": "Self-Created"
},
{
"code": "licensed",
"name": "Licensed"
},
{
"code": "public_domain",
"name": "Public Domain"
},
{
"code": "ai",
"name": "AI-Generated"
},
{
"code": "other",
"name": "Other"
}
],
"index_artworkSource": 1,
"artworkLicenseNotes": "string",
"index_artworkLicenseNotes": 2
}
}
