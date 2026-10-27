# Graph Report - kajm1ller.github.io-1  (2026-10-26)

## Corpus Check
- Large corpus: 1672 files · ~1,217,962 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3468 nodes · 6575 edges · 232 communities (156 shown, 76 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 371 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Bar Storefront Textures
- City Nav Baker
- Net Cops & Replicas
- Impacts & Character Meshes
- Air Traffic
- Bar Audio
- Anothermapo Map Loader
- IDM & Pure Pursuit AI
- Agent Progress Logs
- Bedroom Page (game)
- Street Signs Baker
- Traffic & Test Harness Notes
- Physics & Architecture Notes
- Arcade Dice/HiLo
- Pedestrian System
- Car Crashes
- SpatialGrid Audit Notes
- Arcade Cards & Poker
- Gas Stations
- Street Lamps Baker
- Civic Instancing Tests
- Drugs & Alcohol
- Ragdoll & Pedestrian Anim
- Pedestrian Spawning
- Guns & Items
- Mermaid World Data
- Disembark Sync Notes
- Arcade UI
- Police Siren Audio
- Money & Wallet HUD
- Vehicle Physics
- Instanced Fleet (proposed)
- Parked Cars
- Bars Baker
- Vehicle Stress Tests & NetWorld
- Proposed Map Loader
- Police Officers
- Street Map Baker
- Main Loop Audit
- Fleet Profiling
- Avatar Poses
- Car Models
- Remote Players
- Road Signs
- Vehicle Transitions
- Environment & Trees
- Mermaid Dialogue
- Weapon Wheel
- Bar Talk
- City Nav Runtime
- Mermaid World Build
- CDP Harness
- Day/Night Cycle
- Districts
- Traffic Manager
- Traffic Agent
- Traffic Net
- Road Network (proposed)
- Car Interior & Glass
- Mermaid UI
- Server
- Minor cluster 61
- Minor cluster 62
- Minor cluster 63
- Minor cluster 64
- Minor cluster 65
- Minor cluster 66
- Minor cluster 67
- Minor cluster 68
- Minor cluster 69
- Minor cluster 70
- Minor cluster 71
- Arcade Wallet
- Minor cluster 73
- Minor cluster 74
- Minor cluster 75
- Minor cluster 76
- Minor cluster 77
- Minor cluster 78
- Minor cluster 79
- Minor cluster 80
- package.json Deps
- Minor cluster 82
- Minor cluster 83
- Minor cluster 84
- Minor cluster 85
- Minor cluster 86
- Minor cluster 87
- Minor cluster 88
- Minor cluster 89
- Minor cluster 90
- Minor cluster 91
- Minor cluster 92
- Minor cluster 93
- Minor cluster 94
- Minor cluster 95
- Minor cluster 96
- Minor cluster 97
- Minor cluster 98
- Minor cluster 99
- Minor cluster 100
- Minor cluster 101
- Minor cluster 102
- Minor cluster 103
- Minor cluster 104
- Minor cluster 105
- Minor cluster 106
- Minor cluster 107
- Minor cluster 108
- Minor cluster 109
- Minor cluster 110
- Minor cluster 111
- Minor cluster 112
- Minor cluster 113
- Minor cluster 114
- Minor cluster 115
- Minor cluster 116
- Minor cluster 117
- Minor cluster 118
- Minor cluster 119
- Minor cluster 120
- Minor cluster 121
- Minor cluster 122
- Minor cluster 123
- Minor cluster 124
- Minor cluster 125
- Minor cluster 126
- Minor cluster 127
- Minor cluster 128
- Minor cluster 129
- Minor cluster 130
- Minor cluster 131
- Minor cluster 132
- Minor cluster 133
- Minor cluster 134
- Minor cluster 135
- Minor cluster 136
- Minor cluster 137
- Minor cluster 138
- Minor cluster 139
- Minor cluster 140
- Minor cluster 141
- Minor cluster 142
- Minor cluster 143
- Minor cluster 144
- Minor cluster 145
- Minor cluster 146
- Minor cluster 147
- Minor cluster 148
- Minor cluster 149
- Minor cluster 150
- Minor cluster 151
- Minor cluster 152
- Minor cluster 153
- Minor cluster 154
- Minor cluster 155
- Minor cluster 156
- Minor cluster 157
- Minor cluster 158
- Minor cluster 159
- Minor cluster 160
- Minor cluster 161
- Minor cluster 162
- Minor cluster 163
- Minor cluster 164
- Minor cluster 165
- Minor cluster 166
- Minor cluster 167
- Minor cluster 168
- Minor cluster 169
- Minor cluster 170
- Minor cluster 171
- Minor cluster 172
- Minor cluster 173
- Minor cluster 174
- Minor cluster 175
- Minor cluster 177
- Minor cluster 178
- Minor cluster 180
- Minor cluster 181
- Minor cluster 182
- Minor cluster 183
- Minor cluster 185
- Minor cluster 186
- Minor cluster 187
- Minor cluster 188
- Minor cluster 189
- Minor cluster 190
- Minor cluster 194
- Minor cluster 195
- Minor cluster 196
- Minor cluster 197
- Minor cluster 198
- Minor cluster 199
- Minor cluster 200
- Minor cluster 201
- Minor cluster 202
- Minor cluster 203
- Minor cluster 204
- Minor cluster 205
- Minor cluster 206
- Minor cluster 207
- Minor cluster 208
- Minor cluster 209
- Minor cluster 210
- Minor cluster 211
- Minor cluster 212
- Minor cluster 213
- Minor cluster 214
- Minor cluster 215
- Minor cluster 216
- Minor cluster 217
- Minor cluster 218
- Minor cluster 219
- Minor cluster 220
- Minor cluster 221
- Minor cluster 222
- Minor cluster 223
- Minor cluster 224
- Minor cluster 225
- Minor cluster 226
- Minor cluster 227
- Minor cluster 229
- Minor cluster 230
- Minor cluster 231

## God Nodes (most connected - your core abstractions)
1. `PedestrianSystem` - 88 edges
2. `three` - 72 edges
3. `Vehicle` - 51 edges
4. `Bars` - 45 edges
5. `SceneDirector` - 45 edges
6. `MermaidWorld` - 44 edges
7. `canvasTex()` - 43 edges
8. `rng()` - 29 edges
9. `PoliceSystem` - 29 edges
10. `SpatialGrid` - 27 edges

## Surprising Connections (you probably didn't know these)
- `MockVehicle` --semantically_similar_to--> `Vehicle`  [INFERRED] [semantically similar]
  test/mock-game.html → js/game/vehicle.js
- `tools/carPreview.html (Car Showroom)` --references--> `CarInterior`  [EXTRACTED]
  tools/carPreview.html → js/game/carInterior.js
- `tools/carPreview.html (Car Showroom)` --references--> `buildCarMesh()`  [EXTRACTED]
  tools/carPreview.html → js/game/carModels.js
- `tools/carPreview.html (Car Showroom)` --references--> `InstancedVehicleFleet`  [EXTRACTED]
  tools/carPreview.html → js/game/instancedFleet.js
- `test/mock-game.html (Kaj Simulator conformance mock)` --references--> `SpatialGrid`  [EXTRACTED]
  test/mock-game.html → js/game/spatialGrid.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Milestone 1 engine core** — _agents_teamwork_spatial_grid, _agents_teamwork_fixed_timestep_loop, _agents_teamwork_window_game_api [EXTRACTED 1.00]
- **Milestone 3 traffic and scalability stack** — _agents_teamwork_ai_traffic_fleet, _agents_teamwork_anti_deadlock_overlap, _agents_teamwork_instanced_fleet_rendering, _agents_teamwork_road_network [INFERRED 0.85]
- **Gate verification participants** — _agents_teamwork_gate_process, _agents_teamwork_forensic_audit, _agents_teamwork_cdp_test_harness [INFERRED 0.75]
- **Milestone 1-2 challenger APPROVE verdicts** — _agents_teamwork_teamwork_preview_challenger_m1_1_handoff_verdict_approve, _agents_teamwork_teamwork_preview_challenger_m1_2_handoff_verdict_approve, _agents_teamwork_teamwork_preview_challenger_m2_1_handoff_verdict_approve, _agents_teamwork_teamwork_preview_challenger_m2_2_handoff_verdict_approve, _agents_teamwork_teamwork_preview_challenger_m2_2_1_handoff_verdict_approve [INFERRED 0.85]
- **Milestone 1 Foundation (startup fix, fixed timestep, SpatialGrid, test API)** — agents_teamwork_teamwork_preview_explorer_m1_1_handoff_viewmodel_reference_error, agents_teamwork_teamwork_preview_explorer_m1_1_handoff_fixed_timestep_loop, agents_teamwork_teamwork_preview_explorer_m1_2_handoff_spatialgrid, agents_teamwork_teamwork_preview_explorer_m1_3_handoff_game_api [INFERRED 0.85]
- **Zero-Allocation SpatialGrid Techniques** — agents_teamwork_teamwork_preview_explorer_m1_2_handoff_active_cell_tracking, agents_teamwork_teamwork_preview_explorer_m1_2_handoff_query_id_dedup, agents_teamwork_teamwork_preview_explorer_m1_2_handoff_dynamic_entry_pooling [EXTRACTED 0.95]
- **Civic Vehicle Optimization (pooling, wheels, zero-allocation update)** — agents_teamwork_teamwork_preview_explorer_kaj_car_handoff_geometry_material_pool, agents_teamwork_teamwork_preview_explorer_kaj_car_handoff_steerable_rolling_wheels, agents_teamwork_teamwork_preview_explorer_kaj_car_handoff_zero_allocation_update [EXTRACTED 0.95]
- **Milestone 2 Player Vehicle Systems** — _agents_teamwork_teamwork_preview_explorer_m2_2_handoff_kinematic_bicycle_model, _agents_teamwork_teamwork_preview_explorer_m2_3_handoff_player_state_machine, _agents_teamwork_teamwork_preview_explorer_m2_3_handoff_chase_camera, _agents_teamwork_teamwork_preview_explorer_m2_3_handoff_safe_exit_placement [INFERRED 0.85]
- **Milestone 3 Traffic Control Stack** — _agents_teamwork_teamwork_preview_explorer_m3_1_handoff_pure_pursuit_steering, _agents_teamwork_teamwork_preview_explorer_m3_1_handoff_idm_car_following, _agents_teamwork_teamwork_preview_explorer_m3_1_handoff_yellow_box_intersection_lock, _agents_teamwork_teamwork_preview_explorer_m3_2_handoff_traffic_deadlock_watchdog, _agents_teamwork_teamwork_preview_explorer_m3_2_handoff_anti_overlap_enforcer [INFERRED 0.85]
- **50-Vehicle Scalability Stack** — _agents_teamwork_teamwork_preview_explorer_m3_3_handoff_instanced_mesh_architecture, _agents_teamwork_teamwork_preview_explorer_m3_3_handoff_physics_tick_profile, _agents_teamwork_teamwork_preview_explorer_m3_3_handoff_fleet_metrics_telemetry [INFERRED 0.85]
- **Milestone 1 startup-fix review chain** — _agents_teamwork_teamwork_preview_explorer_survey_1_handoff_viewmodelscene_startup_bug, _agents_teamwork_teamwork_preview_reviewer_m1_1_handoff_verdict_approve_m1, _agents_teamwork_teamwork_preview_reviewer_m1_2_handoff_verdict_approve_m1 [INFERRED 0.75]
- **AI traffic navigation stack** — _agents_teamwork_teamwork_preview_explorer_survey_3_handoff_directed_waypoint_graph, _agents_teamwork_teamwork_preview_explorer_survey_3_handoff_intelligent_driver_model, _agents_teamwork_teamwork_preview_explorer_survey_3_handoff_pure_pursuit_steering, _agents_teamwork_teamwork_preview_explorer_survey_3_handoff_spatial_grid_forward_sensing [INFERRED 0.85]
- **Vehicle physics and collision stack** — _agents_teamwork_teamwork_preview_explorer_survey_2_handoff_kinematic_bicycle_model, _agents_teamwork_teamwork_preview_explorer_survey_2_handoff_obb_sat_three_circle_collision, _agents_teamwork_teamwork_preview_explorer_survey_2_handoff_nan_guard_collision_response, _agents_teamwork_teamwork_preview_explorer_survey_2_handoff_world_boundary_clamp [INFERRED 0.85]
- **Milestone 2 gate reviews** — _agents_teamwork_teamwork_preview_reviewer_m2_2_handoff, _agents_teamwork_teamwork_preview_reviewer_m2_2_1_handoff, _agents_teamwork_teamwork_preview_reviewer_m2_2_2_handoff [EXTRACTED 1.00]
- **Crime reporting to police dispatch and chase music flow** — game_police_integration, game_dispatch_queue, game_setpolicechasemusic, game_damagetarget [EXTRACTED 1.00]
- **Car-versus-pedestrian collision and ragdoll pipeline** — game_hitpedestrianwithvehicle, game_stepcarcontact, game_checkrunovers, game_witnessesreact [EXTRACTED 1.00]
- **Shared world multiplayer synchronisation** — game_multiplayer, game_shared_world_net, game_handlenetmessage, game_riding_npc_passengers [EXTRACTED 1.00]
- **Three navigable rooms (main, music, bedroom) sharing camera transitions** — index_main_room, index_music_room, index_bedroom_room, index_roomconfigs [EXTRACTED 1.00]
- **Spotify queue flow (search, add, poll, render on monitor)** — index_searchspotifytracks, index_addtospotifyqueue, index_updatespotifydata, index_renderspotifyscreen [EXTRACTED 1.00]
- **Care simulation loop (state, actions, disease, visuals)** — index_carestate, index_runcareaction, index_updatecaresimulation, index_maybecatchdisease, index_updatecarevisuals [EXTRACTED 1.00]
- **M2 drivable vehicle subsystem** — agents_teamwork_teamwork_preview_worker_m2_handoff_roadnetwork, agents_teamwork_teamwork_preview_worker_m2_handoff_vehicle_physics, agents_teamwork_teamwork_preview_worker_m2_handoff_playercontroller, agents_teamwork_teamwork_preview_worker_m2_handoff_cameracontroller [EXTRACTED 1.00]
- **E2E test stack** — test_infra_cdp_harness, test_infra_functional_suite, test_infra_benchmark_suite, test_infra_master_runner [EXTRACTED 1.00]
- **Spotify queue page flow** — music_fetchnowplaying, music_fetchqueue, music_searchtracks, music_addtoqueue, music_spotify_api [EXTRACTED 1.00]
- **Dev preview pages for game assets** — tools_carpreview, tools_gunpreview, test_mock_game [INFERRED 0.75]

## Communities (232 total, 76 thin omitted)

### Community 0 - "Bar Storefront Textures"
Cohesion: 0.05
Nodes (115): archTex(), art(), ART_TEXT, awningSideTex(), blindsTex(), buildAtticUpstairs(), buildAwning(), buildClazel() (+107 more)

### Community 1 - "City Nav Baker"
Cohesion: 0.02
Nodes (87): allWayNodes, amenities, asphalt, BAR_AMENITIES, blockerGrid, blockers, bm, [bMaxX, bMinZ] (+79 more)

### Community 2 - "Net Cops & Replicas"
Cohesion: 0.05
Nodes (23): colorOf(), NetCops, NetOwner, NetReplica, q100(), q1000(), q20(), angleDiff() (+15 more)

### Community 3 - "Impacts & Character Meshes"
Cohesion: 0.06
Nodes (32): BLOOD_COLORS, bloodTexture(), canvasTexture(), charMaterials(), charVehicleMesh(), DecalLayer, DUST_COLOR, _hits (+24 more)

### Community 4 - "Air Traffic"
Cohesion: 0.06
Nodes (20): AIR_CONFIG, AirTraffic, angleDiff(), APRON_EXIT, between(), ground(), leg(), PLANE_COLORS (+12 more)

### Community 5 - "Bar Audio"
Cohesion: 0.08
Nodes (8): BAR_CONFIG, BarAudio, Bars, localToWorld(), prepareStorefront(), specFor(), worldToLocal(), data

### Community 6 - "Anothermapo Map Loader"
Cohesion: 0.07
Nodes (15): ANOTHERMAPO_CONFIG, AnothermapoLoader, applyMapMaterialClass(), classifyMapMaterial(), classifySurfaceLook(), colorNear(), _face, _num3 (+7 more)

### Community 7 - "IDM & Pure Pursuit AI"
Cohesion: 0.06
Nodes (19): IDMController, PurePursuitController, _scratchForward, _scratchNeighborResults, _scratchRight, _scratchSpatialResults, SQRT_AB, TRAFFIC_CONFIG (+11 more)

### Community 8 - "Agent Progress Logs"
Cohesion: 0.07
Nodes (42): Milestone 1 Progress Log, Milestone 1: engine core (fixed 60Hz loop, SpatialGrid, __GAME__ API), M2 Worker Briefing, M2 Worker Dispatch, M2 Fix Worker Briefing, M2 Fix Worker Dispatch, M2 Fix Handoff Report, M2 Fix Progress Log (+34 more)

### Community 9 - "Bedroom Page (game)"
Cohesion: 0.06
Nodes (44): activatePhysics, addToSpotifyQueue, animate (main render loop), applyMusicRoomTextures, Bedroom pickup/poke pointer logic, Bedroom / care room (bed, lamp, shower, bowl), bedroomGuy (care room occupant limbs), Camera-orientation-driven gravity tilt (+36 more)

### Community 10 - "Street Signs Baker"
Cohesion: 0.05
Nodes (35): asphalt, atNode, bgrid, bm, [bMaxX, bMinZ], [bMinX, bMaxZ], buildingRings, DIRS (+27 more)

### Community 11 - "Traffic & Test Harness Notes"
Cohesion: 0.10
Nodes (22): AI Traffic Fleet (IDM + Pure Pursuit), /anothermapo city map, Intersection reservation and anti-deadlock watchdog, Native CDP headless test harness, Fixed 60Hz timestep loop, Forensic integrity audit (CLEAN/VIOLATION), Milestone verification gate, InstancedMesh fleet rendering (+14 more)

### Community 12 - "Physics & Architecture Notes"
Cohesion: 0.07
Nodes (23): collisionMeshes linear AABB scan bottleneck, teamwork_preview_explorer_survey_1 handoff.md, Corrupting merge commit 50f7488, game.html ReferenceError viewmodelScene startup crash, teamwork_preview_explorer_survey_2 handoff.md, On-foot vs in-vehicle input mapping, Prior vehicle prototype commit 7e9eef5 and defects, window.__GAME__ testing API contract (+15 more)

### Community 13 - "Arcade Dice/HiLo"
Cohesion: 0.08
Nodes (24): diceMult(), mount(), refresh(), roll(), hiloOdds(), hiloRight(), HOUSE, mount() (+16 more)

### Community 15 - "Car Crashes"
Cohesion: 0.10
Nodes (9): CRASH_CONFIG, CrashAudio, CrashSystem, _dir, _inv, _m, _n3, _p (+1 more)

### Community 16 - "SpatialGrid Audit Notes"
Cohesion: 0.09
Nodes (12): spatialGrid stress test suite (100k queries, oracle), Verdict APPROVE: spatialGrid robust, zero-allocation, 50,000 waypoint query zero-leak verification, Commit 7e9eef5 brute-force raycast collision bottleneck, OSM road network alignment (6 streets, 8 junctions), proposed_map_loader.js (AnothermapoLoader blueprint), anothermapo OSM2World map (92 OBJ parts), CONFIG (+4 more)

### Community 17 - "Arcade Cards & Poker"
Cohesion: 0.10
Nodes (31): bacTotal(), bacValue(), cardText(), describePoker(), evaluatePoker(), HAND_NAMES, newDeck(), playBaccarat() (+23 more)

### Community 18 - "Gas Stations"
Cohesion: 0.10
Nodes (18): brandOf(), BRANDS, CANOPY, canvasTexture(), CLERK, COUNTER, GAS_CONFIG, GasStations (+10 more)

### Community 19 - "Street Lamps Baker"
Cohesion: 0.06
Nodes (30): asphalt, bgrid, bm, [bMaxX, bMinZ], [bMinX, bMaxZ], buildingRings, inBuilding(), isAsphalt() (+22 more)

### Community 20 - "Civic Instancing Tests"
Cohesion: 0.06
Nodes (34): bodyGeo, bodyMat, bodyMesh, bumperMat, bumperMesh, bumpersGeo, cabinGeo, cabinMat (+26 more)

### Community 21 - "Drugs & Alcohol"
Cohesion: 0.10
Nodes (27): ALCOHOL, ALCOHOL_IDS, ANIMS, AUX_HIDE, buildDrugViewmodel(), CRASH, drawDrugIcon(), DRUG_IDS (+19 more)

### Community 23 - "Pedestrian Spawning"
Cohesion: 0.08
Nodes (27): ACCENT_COLORS, ALL_DOORS, box(), buildFurnitureGeometries(), buildPartGeometries(), buildRig(), FurnitureRenderer, HAIR_COLORS (+19 more)

### Community 24 - "Guns & Items"
Cohesion: 0.10
Nodes (28): drugDef(), allWeaponDefs(), AMMO, ammoDef(), buildGunModel(), drawAmmoIcon(), drawFistIcon(), drawGunIcon() (+20 more)

### Community 25 - "Mermaid World Data"
Cohesion: 0.10
Nodes (29): ACCESSORIES, defaultLook(), EYE_COLORS, EYE_SHAPES, EYESHADOWS, FRIEND_LINES, HAIR_COLORS, HAIR_STYLES (+21 more)

### Community 26 - "Disembark Sync Notes"
Cohesion: 0.11
Nodes (17): Disembark position sync (myPosition, controller, camera), playerDisembarkStress unit + e2e suites, Verdict APPROVE: no collapse to 0.00m after disembark, Boarding proximity boundary 3.5m, lerpAngle shortest-arc camera interpolation, Safe exit candidate order Left-Right-Rear-Front, playerCamera stress suite (unit + CDP e2e), Verdict APPROVE: player FSM and camera robust (+9 more)

### Community 27 - "Arcade UI"
Cohesion: 0.14
Nodes (10): ArcadeUI, cardEl(), el(), isRed(), rand(), randInt(), rankName(), SUITS (+2 more)

### Community 29 - "Money & Wallet HUD"
Cohesion: 0.12
Nodes (9): bailFine(), CashDrops, formatMoney(), hospitalBill(), makeBillTexture(), MONEY_CONFIG, MoneyHUD, round2() (+1 more)

### Community 30 - "Vehicle Physics"
Cohesion: 0.10
Nodes (7): Vehicle, createHondaCivicMesh, window.__GAME__ test API, MockVehicle, simulation.runBenchmark, updateHudState, assertVehicleFinite()

### Community 31 - "Instanced Fleet (proposed)"
Cohesion: 0.09
Nodes (19): InstancedVehicleFleet, mergeBufferGeometries(), _scratchColor, _scratchEuler, _scratchMat4, _scratchPos, _scratchQuat, _scratchScale (+11 more)

### Community 32 - "Parked Cars"
Cohesion: 0.15
Nodes (10): pickCarColor(), pickCarModel(), districtProfile(), carYaw(), hash01(), PARKED_CONFIG, ParkedCars, _pt (+2 more)

### Community 33 - "Bars Baker"
Cohesion: 0.07
Nodes (20): AREA, bm, buildings, FACE, found, groups, KINDS, MAP_OFFSET (+12 more)

### Community 34 - "Vehicle Stress Tests & NetWorld"
Cohesion: 0.09
Nodes (18): vehicleRoadStress adversarial test suite (14 tests), _validateState lastSafePosition recovery, Verdict APPROVE: vehicle physics and road queries resilient, F, NET_CONFIG, PED_STATES, STATE_CODE, BASE_PHYSICS (+10 more)

### Community 35 - "Proposed Map Loader"
Cohesion: 0.10
Nodes (5): ANOTHERMAPO_CONFIG, AnothermapoLoader, OSM_NEIGHBORHOOD_ROADS, OSMRoadNetwork, VehicleSpatialCollider

### Community 36 - "Police Officers"
Cohesion: 0.08
Nodes (23): createPoliceOfficerMesh(), officerArmGeo, officerBadgeGeo, officerBodyGeo, officerBrimMat, officerGoldBadgeMat, officerGunGeo, officerGunMat (+15 more)

### Community 37 - "Street Map Baker"
Cohesion: 0.08
Nodes (18): bm, CLASSES, kept, labels, MAP_OFFSET, mercY(), nodes, osm (+10 more)

### Community 38 - "Main Loop Audit"
Cohesion: 0.12
Nodes (12): step(dt) lacks non-finite dt guard (NaN poisons position), Headless simulation stress harness (CDP, Edge/Chrome), Verdict APPROVE: loop stable, zero heap growth, initGameAPI(), scratchQueryResults, spatialGrid, PLANE_CONFIG, _scratchTireOffset (+4 more)

### Community 39 - "Fleet Profiling"
Cohesion: 0.12
Nodes (12): grid, roadNetwork, spawns, vehicles, fleet, metrics, scene, t0 (+4 more)

### Community 40 - "Avatar Poses"
Cohesion: 0.16
Nodes (21): JOINTS, poseAim(), poseHold(), poseIdle(), poseSeated(), poseStagger(), poseUse(), poseWalk() (+13 more)

### Community 41 - "Car Models"
Cohesion: 0.14
Nodes (23): boxGeo(), buildModelGeometry(), buildProfile(), _cache, clipHalf(), cylGeo(), dedupe(), DEFAULT_CAR_MODEL (+15 more)

### Community 42 - "Remote Players"
Cohesion: 0.13
Nodes (6): avatarGeos(), createAvatar(), createNameTag(), drawNameTag(), hashId(), RemotePlayers

### Community 43 - "Road Signs"
Cohesion: 0.15
Nodes (15): Batch, canvasTexture(), doNotEnterTexture(), _e, _m, octagon(), oneWayTexture(), _p (+7 more)

### Community 44 - "Vehicle Transitions"
Cohesion: 0.13
Nodes (14): _a, _b, bezier(), _c, climbPoints(), lookQuat(), _m, smooth() (+6 more)

### Community 45 - "Environment & Trees"
Cohesion: 0.15
Nodes (11): addVertexColors(), buildBillboardGeometry(), buildBroadleafGeometry(), buildConiferGeometry(), CloudLayer, createPuffTexture(), jitterVertices(), mulberry32() (+3 more)

### Community 46 - "Mermaid Dialogue"
Cohesion: 0.22
Nodes (3): animateMermaid(), angleDiff(), MermaidWorld

### Community 48 - "Bar Talk"
Cohesion: 0.12
Nodes (20): BAR_LINE_GROUPS, BAR_LINES, barLine(), BATHROOM, BOYS, CIGARETTE, CLASSES, DRINKS (+12 more)

### Community 49 - "City Nav Runtime"
Cohesion: 0.16
Nodes (5): CityNav, FURNITURE, loadCityNav(), PointGrid, WALK_EDGE

### Community 50 - "Mermaid World Build"
Cohesion: 0.25
Nodes (7): between(), canvasTexture(), floorHeight(), mesh(), pick(), signTexture(), std()

### Community 51 - "CDP Harness"
Cohesion: 0.16
Nodes (4): CDPHarness, getFreePort(), startStaticServer(), WebSocket

### Community 52 - "Day/Night Cycle"
Cohesion: 0.14
Nodes (12): _a, _b, DAY_LENGTH_SECONDS, DayNightCycle, formatClock(), MOON_COLOR, MOON_LIGHT, PALETTE (+4 more)

### Community 53 - "Districts"
Cohesion: 0.12
Nodes (17): BOXES_PX, DISTRICT_TYPES, DISTRICTS, DOOR_KIND, nightFactor(), NUMERIC, OUTSKIRTS, pickTable() (+9 more)

### Community 54 - "Traffic Manager"
Cohesion: 0.10
Nodes (16): _c1, _c2, _fr, IDMController, _idmInputsResult, _obstacle, _poseScratch, PurePursuitController (+8 more)

### Community 55 - "Traffic Agent"
Cohesion: 0.22
Nodes (3): removeFrom(), TrafficAgent, wrapAngle()

### Community 56 - "Traffic Net"
Cohesion: 0.12
Nodes (6): DrivePath, LIGHT, NET_CONFIG, _p, segSegDist(), TrafficNet

### Community 57 - "Road Network (proposed)"
Cohesion: 0.14
Nodes (3): Lane, ROAD_CONFIG, RoadNetwork

### Community 58 - "Car Interior & Glass"
Cohesion: 0.14
Nodes (14): CLUSTER_STYLES, DRIVER_EYE, GlassShatterSystem, playGlassShatter(), randomInPane(), SCREEN_BUTTONS, SCREEN_STYLES, _themeMats (+6 more)

### Community 59 - "Mermaid UI"
Cohesion: 0.20
Nodes (3): el(), hex(), MermaidUI

### Community 60 - "Server"
Cohesion: 0.11
Nodes (15): app, ensureToken(), express, fs, googleTTS, GZ_DIR, gzJobs, http (+7 more)

### Community 61 - "Minor cluster 61"
Cohesion: 0.22
Nodes (19): buildingAt(), clearOfRoads(), crossingIntervals(), groundOk(), inBlocker(), inBuilding(), inGreen(), inLot() (+11 more)

### Community 63 - "Minor cluster 63"
Cohesion: 0.14
Nodes (4): AntiOverlapEnforcer, IntersectionConflictZone, IntersectionManager, TrafficWatchdogCoordinator

### Community 64 - "Minor cluster 64"
Cohesion: 0.16
Nodes (10): CAR_MODELS, CAR_SEATS, CarRiders, LOOKS, npcOccupants(), _seatCache, seatLocal(), seatWorld() (+2 more)

### Community 65 - "Minor cluster 65"
Cohesion: 0.15
Nodes (3): DrugEffects, emptyState(), smooth()

### Community 66 - "Minor cluster 66"
Cohesion: 0.20
Nodes (3): PlayerController, ensureCivicHUD(), updateCivicHUD()

### Community 67 - "Minor cluster 67"
Cohesion: 0.18
Nodes (9): _circleOffsets, _scratchCollisionResults, _scratchForward, _scratchRight, CameraController, CameraMode, lerpAngle(), PlayerState (+1 more)

### Community 68 - "Minor cluster 68"
Cohesion: 0.18
Nodes (14): beamGeo(), buildCabinFrame(), buildCarMesh(), cabinShape(), getCarModel(), getFleetGeometry(), getModelGeometry(), getPaintMaterial() (+6 more)

### Community 69 - "Minor cluster 69"
Cohesion: 0.20
Nodes (6): districtAt(), boxDepth(), boxDistance(), DistrictStreamer, STREAM_CONFIG, touching()

### Community 70 - "Minor cluster 70"
Cohesion: 0.12
Nodes (14): bm, MAP_OFFSET, mercY(), nodes, osm, OSM_FILE, out, OUT_FILE (+6 more)

### Community 71 - "Minor cluster 71"
Cohesion: 0.12
Nodes (12): allNodes, content, fs, junctions, neighborhoodRoads, nodeToWays, allNodes, content (+4 more)

### Community 72 - "Arcade Wallet"
Cohesion: 0.24
Nodes (4): formatMoney(), round2(), Wallet, WALLET_CONFIG

### Community 73 - "Minor cluster 73"
Cohesion: 0.22
Nodes (5): beam(), box(), CarInterior, cyl(), themeMaterials()

### Community 75 - "Minor cluster 75"
Cohesion: 0.17
Nodes (15): Anti-Deadlock Watchdog 8s/15s, M3 Watchdog Explorer BRIEFING, M3 Watchdog Explorer DISPATCH, M3 Watchdog Explorer Handoff Report, IntersectionManager FIFO Yellow-Box Reservation, test_proposedWatchdog.js (8 tests), TrafficDeadlockWatchdog (nudge 5s, respawn 7s), TrafficWatchdogCoordinator (+7 more)

### Community 76 - "Minor cluster 76"
Cohesion: 0.15
Nodes (8): _circleOffsets, CivicGeometryPool, CivicMaterialPool, createOptimizedHondaCivic(), _scratchCollisionResults, _scratchForward, _scratchImpulse, _scratchRight

### Community 77 - "Minor cluster 77"
Cohesion: 0.20
Nodes (13): fs, gameHtml, path, scriptMatch, vm, a(), e(), i() (+5 more)

### Community 79 - "Minor cluster 79"
Cohesion: 0.14
Nodes (12): CAR_MODEL_IDS, mergeBufferGeometries(), _scratchColor, _scratchEuler, _scratchMat4, _scratchPos, _scratchQuat, _scratchScale (+4 more)

### Community 80 - "Minor cluster 80"
Cohesion: 0.22
Nodes (8): buildLensGeometry(), buildPoleGeometry(), hash01(), LAMP_COLOR, LENS_OFF, LENS_ON, loadStreetLamps(), StreetLamps

### Community 81 - "package.json Deps"
Cohesion: 0.17
Nodes (15): dependencies, @dimforge/rapier3d-compat@^0.19.3, express@^5.3.0, google-tts-api@^2.0.2, ring-client-api@^14.2.0, three@^0.182.0, ws@^8.19.0, name (+7 more)

### Community 83 - "Minor cluster 83"
Cohesion: 0.16
Nodes (11): http, path, run(), { spawn }, WebSocket, fs, http, path (+3 more)

### Community 84 - "Minor cluster 84"
Cohesion: 0.34
Nodes (14): bjCardValue(), bjTotal(), isBlackjack(), dealerPlays(), mount(), current(), doDouble(), doHit() (+6 more)

### Community 85 - "Minor cluster 85"
Cohesion: 0.17
Nodes (11): _cache, carSurface(), COLS, _down, genericHeight(), _hits, _origin, _raycaster (+3 more)

### Community 86 - "Minor cluster 86"
Cohesion: 0.21
Nodes (4): buildClumpGeometry(), createGrassMaterial(), DEFAULTS, GrassSystem

### Community 89 - "Minor cluster 89"
Cohesion: 0.18
Nodes (3): Lane, RoadNetwork, runBatch()

### Community 90 - "Minor cluster 90"
Cohesion: 0.24
Nodes (12): CAR_COLORS, DIFFICULTY, LANES, mount(), begin(), cashOut(), die(), drawCar() (+4 more)

### Community 91 - "Minor cluster 91"
Cohesion: 0.27
Nodes (13): mount(), bettingRound(), botDecide(), cashOut(), endHand(), playerDecide(), playHand(), playLoop() (+5 more)

### Community 92 - "Minor cluster 92"
Cohesion: 0.20
Nodes (3): Cluster, InfoScreen, TaxiMeter

### Community 93 - "Minor cluster 93"
Cohesion: 0.20
Nodes (11): cleanName(), cleanText(), num(), STATES, WebSocket, bot(), require, sleep() (+3 more)

### Community 94 - "Minor cluster 94"
Cohesion: 0.29
Nodes (13): Heading Convention yaw 0 = -Z, M2 Player Interaction Explorer BRIEFING, M2 Player Interaction Explorer DISPATCH, M2 Player Interaction Explorer Handoff Report, Boarding Proximity (3.5m) and Press E to Drive Prompt, Third-Person Chase Camera with lerpAngle, Driving Input Mapping and Contradictory Input Sanitization, Player State Machine ON_FOOT/IN_VEHICLE (+5 more)

### Community 95 - "Minor cluster 95"
Cohesion: 0.26
Nodes (12): M3 Traffic Fleet Explorer BRIEFING, M3 Traffic Fleet Explorer DISPATCH, M3 Traffic Fleet Explorer Handoff Report, Elastic Separation Spring Repulsion, game.html Traffic Placeholder Loop (bug), Intelligent Driver Model Car-Following, Pure Pursuit Steering Controller, TrafficManager / TrafficAgent Fleet (+4 more)

### Community 96 - "Minor cluster 96"
Cohesion: 0.21
Nodes (13): Bars: drinks menu and ordering, damageTarget, Drug use and effects system, explodeAt (blast damage), Gun handling: reload, fire modes, recoil, ADS, killVehicleDriver, Police system hooks and crime calls, shootWeapon (hitscan gun fire) (+5 more)

### Community 97 - "Minor cluster 97"
Cohesion: 0.19
Nodes (3): DrugPostFX, SmokePuffs, smokeTexture()

### Community 98 - "Minor cluster 98"
Cohesion: 0.18
Nodes (13): accessNode(), addPlainStretch(), addWalkEdge(), addWalkNode(), addWalkPolyline(), edgeKind(), hasEdge(), nearestWalkNodeAny() (+5 more)

### Community 99 - "Minor cluster 99"
Cohesion: 0.35
Nodes (10): M2 Vehicle Physics Explorer BRIEFING, M2 Vehicle Physics Explorer DISPATCH, M2 Vehicle Physics Explorer Handoff Report, Lateral Grip Damping and Handbrake Drift, Number.isFinite NaN Guard with lastSafePosition, Procedural Three.js Vehicle Mesh, proposed_vehicle.js (Vehicle class), Braking-vs-Reverse Transmission State Machine (+2 more)

### Community 100 - "Minor cluster 100"
Cohesion: 0.23
Nodes (11): test_writer_e2e handoff.md, test_writer_map BRIEFING.md, worker_m1 handoff.md, anothermapo map and Honda Civic E2E coverage, Native CDP test harness (Edge/Chrome via ws), 1000-frame benchmark (frame<16.6ms, heap<2MB), E2E functional test suite (9 tests), Fixed 60Hz timestep accumulator loop (+3 more)

### Community 101 - "Minor cluster 101"
Cohesion: 0.17
Nodes (10): map.osm OpenStreetMap Source, Neighborhood Street Circuit (6 streets, 1,231m, 8 junctions), Player Start (-120.1,0,64) at Kaj House on Brookwood Drive, Car HUD (#car-indicator, #car-speed-hud), CivicVehicle (kinematic bicycle + 3-circle capsule collision), Honda Civic Car System (createHondaCivic, 7e9eef5), Pedestrian Hit/Ragdoll Impulse Mechanic, Steerable Pivots and Rolling Wheels (+2 more)

### Community 102 - "Minor cluster 102"
Cohesion: 0.17
Nodes (7): 1,000-Frame Zero-Allocation Benchmark (50 vehicles), SpatialGrid (15m cells, 40x40 flat array), Static vs Dynamic Entity Separation, getLookaheadWaypoint Pure Pursuit Traversal, RoadNetwork (directed dual-lane waypoint graph), Downstream Vehicle and AI Traffic Dependencies, Unmasked Tree/Rock Placement in generateWorld()

### Community 104 - "Minor cluster 104"
Cohesion: 0.17
Nodes (11): geo, instancedWheels, mat, _scratchEuler, _scratchMat4, _scratchPos, _scratchQuat, _scratchScale (+3 more)

### Community 105 - "Minor cluster 105"
Cohesion: 0.21
Nodes (8): bbox(), CityMap, LABEL_SCALE, MIN_SCALE, ROAD_WIDTH, rotatedAngle(), strokeLine(), THEMES

### Community 107 - "Minor cluster 107"
Cohesion: 0.38
Nodes (10): box(), buildFish(), buildMermaid(), cyl(), joint(), lerpColor(), mat(), _mats (+2 more)

### Community 108 - "Minor cluster 108"
Cohesion: 0.27
Nodes (10): attachMultiplayer(), broadcast(), broadcastPlayerList(), ejectRidersOf(), peersIn(), playerList(), recomputeOwners(), releaseRider() (+2 more)

### Community 109 - "Minor cluster 109"
Cohesion: 0.18
Nodes (9): allNodes, buildingWays, content, drivableRoads, drivableTypes, fs, nearRoads, roadTypeCounts (+1 more)

### Community 111 - "Minor cluster 111"
Cohesion: 0.27
Nodes (10): FREE_SPIN_MULT, FREE_SPINS, LINES, mount(), spin(), pickSymbol(), slotPayout(), spinSlots() (+2 more)

### Community 112 - "Minor cluster 112"
Cohesion: 0.24
Nodes (8): art(), chunk(), crc32(), fs, mix(), path, png(), zlib

### Community 113 - "Minor cluster 113"
Cohesion: 0.29
Nodes (3): ENGINE_VOICES, EngineSound, shaperCurve()

### Community 115 - "Minor cluster 115"
Cohesion: 0.18
Nodes (8): DEFAULT_BROWSER_PATHS, fs, http, MIME_TYPES, net, os, path, { spawn, execSync }

### Community 116 - "Minor cluster 116"
Cohesion: 0.33
Nodes (6): assert(), assertEqual(), assertFiniteNumber(), path, runFunctionalTests(), TestContext

### Community 117 - "Minor cluster 117"
Cohesion: 0.31
Nodes (10): M3 Instanced Fleet Explorer BRIEFING, M3 Instanced Fleet Explorer DISPATCH, M3 Instanced Fleet Explorer Handoff Report, getFleetMetrics Telemetry Contract, Kaj Simulator Honda Civic Decomposition, 7-InstancedMesh Fleet Rendering (1050 to 7 draw calls), 50-Vehicle Physics Tick Profile (0.083ms), proposed_instancedFleet.js (InstancedVehicleFleet) (+2 more)

### Community 118 - "Minor cluster 118"
Cohesion: 0.20
Nodes (4): __dirname, __filename, rootDir, server

### Community 119 - "Minor cluster 119"
Cohesion: 0.31
Nodes (9): CHIP_COLORS, colorOf(), mount(), addBet(), render(), spin(), REDS, rouletteReturn() (+1 more)

### Community 120 - "Minor cluster 120"
Cohesion: 0.29
Nodes (8): crashPoint(), GROWTH, mount(), cashOut(), place(), press(), multAt(), NAMES

### Community 121 - "Minor cluster 121"
Cohesion: 0.20
Nodes (10): animate (main loop), Day/night cycle usage, Graphics quality picker (__gfxChoice), LSD trip to Mermaid World, renderDrugFrame, renderFrame, Scene, renderer, sky and lighting setup, updateLsdTrip (+2 more)

### Community 122 - "Minor cluster 122"
Cohesion: 0.27
Nodes (10): Car interior / cockpit handling, Carjacking animation, checkCollision (spatial grid), Pedestrian system integration (talk, flee, update), Spray can and image paste decals, stepSimulation (fixed 60Hz update), AI traffic fleet and district streaming setup, tryBoardOrJackVehicle (+2 more)

### Community 124 - "Minor cluster 124"
Cohesion: 0.29
Nodes (5): bladeLength(), buildAtlas(), COLS, loadStreetSigns(), StreetSigns

### Community 125 - "Minor cluster 125"
Cohesion: 0.29
Nodes (7): bot(), none(), require, sleep(), startServer(), waitFor(), WebSocket

### Community 126 - "Minor cluster 126"
Cohesion: 0.38
Nodes (7): runBenchmark(), toMB(), createHarness(), findBrowserPath(), main(), path, runHarnessSelfTest()

### Community 127 - "Minor cluster 127"
Cohesion: 0.22
Nodes (6): Anothermapo Handoff Report, Anothermapo OBJ Map (92 parts, OSM2World export), 7e9eef5 Linear collisionMeshes Collision Bottleneck, proposed_map_loader.js (AnothermapoLoader, OSMRoadNetwork), Anothermapo Progress Log, Linear collisionMeshes Scan Bottleneck (8,725 checks/frame)

### Community 128 - "Minor cluster 128"
Cohesion: 0.22
Nodes (8): Headless Edge CDP Zero-Error Boot Verification, Merge Commit 50f7488 Corruption, Uninvoked House/Combat Merge Debris (lines 562-925), Corrupted sprayAtTarget() (undeclared t), ReferenceError: viewmodelScene is not defined (strict-mode boot failure), SpatialGrid Prototype (0.56us/query, 6 tests), Startup Defect: undeclared viewmodel vars in strict module, Unit and Headless Verification Strategy

### Community 129 - "Minor cluster 129"
Cohesion: 0.31
Nodes (5): getKey(), i(), isStopKey(), keydown(), keyup()

### Community 130 - "Minor cluster 130"
Cohesion: 0.31
Nodes (6): applySource(), cents(), installSoundRate(), media, setSoundRate(), sources

### Community 131 - "Minor cluster 131"
Cohesion: 0.39
Nodes (6): frame(), idle(), init(), onAnimationFrame(), resetIdleAnimation(), setSprite()

### Community 132 - "Minor cluster 132"
Cohesion: 0.22
Nodes (7): camera, cube, geometry, material, renderer, scene, threeTest.html (three.js starter page)

### Community 133 - "Minor cluster 133"
Cohesion: 0.25
Nodes (8): activatePhysics, animate loop, cannon-es physics world (cube walls, ragdoll, chair), createRagdoll, findClosestBody, fireGun, onMouseDown / onTouchStart drag handlers, updateRagdoll

### Community 134 - "Minor cluster 134"
Cohesion: 0.22
Nodes (8): copyRecursive(), destDir, entryBase, fs, path, pkgJsonPath, shimPath, srcDir

### Community 135 - "Minor cluster 135"
Cohesion: 0.36
Nodes (4): reviewer_m2_2_1 handoff.md, reviewer_m2_2_2 handoff.md, reviewer_m2_2 handoff.md, getNearestVehicle alias of getNearbyVehicle

### Community 136 - "Minor cluster 136"
Cohesion: 0.46
Nodes (6): minesMult(), mount(), cashOut(), pickRandom(), reveal(), showAll()

### Community 137 - "Minor cluster 137"
Cohesion: 0.68
Nodes (8): mount(), begin(), build(), cashOut(), pick(), refresh(), showAll(), towerMult()

### Community 140 - "Minor cluster 140"
Cohesion: 0.43
Nodes (6): neko(), frame(), idle(), init(), resetIdleAnimation(), setSprite()

### Community 141 - "Minor cluster 141"
Cohesion: 0.29
Nodes (8): music.html (Kaj's Music page), addToQueue, displaySearchResults, CSS EQ visualizer, fetchNowPlaying, fetchQueue, searchTracks, /api/spotify backend (now-playing, queue, search, add-to-queue)

### Community 142 - "Minor cluster 142"
Cohesion: 0.36
Nodes (3): runE2EDisembarkStress(), f(), StressSuiteContext

### Community 143 - "Minor cluster 143"
Cohesion: 0.33
Nodes (7): Blood pools and impacts, damagePlayer (death and respawn), window.__DRUGS__/__MONEY__/__CRASH__/__BARS__/__GAS__/__DISTRICTS__/__NET__ debug handles, Plane crash, explosions and respawn, Player dive and vehicle ragdoll, updateDrugs, updateDrunk (vomit and pass out)

### Community 144 - "Minor cluster 144"
Cohesion: 0.33
Nodes (7): Casino app iframe pinned to phone, Dev menu and fly camera, Gas station robbery integration, Minimap and street map, Wallet, cash drops and money HUD usage, Phone viewmodel and apps, spawnVehicle (dev menu)

### Community 145 - "Minor cluster 145"
Cohesion: 0.33
Nodes (7): Police dispatch voice queue, ensureBackgroundMusicPlaying, ensureCarAudioEngine (shared AudioContext), In-car radio system, setPoliceChaseMusic, toggleEngine, updateCarAudio

### Community 146 - "Minor cluster 146"
Cohesion: 0.57
Nodes (6): frame(), idle(), init(), onAnimationFrame(), resetIdleAnimation(), setSprite()

### Community 147 - "Minor cluster 147"
Cohesion: 0.43
Nodes (3): path, runE2EStress(), StressSuiteContext

### Community 148 - "Minor cluster 148"
Cohesion: 0.48
Nodes (3): runSimulationStressSuite(), StressReporter, toMB()

### Community 149 - "Minor cluster 149"
Cohesion: 0.33
Nodes (4): addStall(), BoxGrid, markPlaced(), placeBench()

### Community 150 - "Minor cluster 150"
Cohesion: 0.40
Nodes (4): window.__GAME__.simulation.step Testing Hook, ES Module Architecture (game.html imports js/game/main.js, config.js), window.__GAME__ Testing API Contract, simulation.runBenchmark Telemetry

### Community 155 - "Minor cluster 155"
Cohesion: 0.47
Nodes (3): hallImpulse(), installSoundFx(), longRunning()

### Community 156 - "Minor cluster 156"
Cohesion: 0.50
Nodes (4): Codebase Survey BRIEFING, 2D Spatial Hash Grid (~15m cells), game.html viewmodelScene ReferenceError (merge 50f7488), Codebase Survey DISPATCH

### Community 157 - "Minor cluster 157"
Cohesion: 0.50
Nodes (4): GUIDE, mount(), claim(), refresh()

### Community 159 - "Minor cluster 159"
Cohesion: 0.50
Nodes (5): applyLookDelta, HUD stacks and panel CSS, Keyboard and mouse input handlers, Mobile touch controls, Public indecency (stroking) mechanic

### Community 160 - "Minor cluster 160"
Cohesion: 0.40
Nodes (5): Multiplayer chat, handleNetMessage / handleMpMessage, Multiplayer client integration, Ride along and NPC passengers, Shared world: regions, owners, replicas

### Community 161 - "Minor cluster 161"
Cohesion: 0.40
Nodes (5): scripts, build:nav, dev, server, start

### Community 162 - "Minor cluster 162"
Cohesion: 0.50
Nodes (4): teamwork_preview_challenger_m1_1 BRIEFING.md, teamwork_preview_challenger_m1_1 DISPATCH.md, teamwork_preview_challenger_m1_1 handoff.md, teamwork_preview_challenger_m1_1 progress.md

### Community 163 - "Minor cluster 163"
Cohesion: 0.50
Nodes (4): teamwork_preview_challenger_m1_2 BRIEFING.md, teamwork_preview_challenger_m1_2 DISPATCH.md, teamwork_preview_challenger_m1_2 handoff.md, teamwork_preview_challenger_m1_2 progress.md

### Community 164 - "Minor cluster 164"
Cohesion: 0.50
Nodes (4): teamwork_preview_challenger_m2_1 BRIEFING.md, teamwork_preview_challenger_m2_1 DISPATCH.md, teamwork_preview_challenger_m2_1 handoff.md, teamwork_preview_challenger_m2_1 progress.md

### Community 165 - "Minor cluster 165"
Cohesion: 0.50
Nodes (4): teamwork_preview_challenger_m2_2_1 BRIEFING.md, teamwork_preview_challenger_m2_2_1 DISPATCH.md, teamwork_preview_challenger_m2_2_1 handoff.md, teamwork_preview_challenger_m2_2_1 progress.md

### Community 166 - "Minor cluster 166"
Cohesion: 0.50
Nodes (4): teamwork_preview_challenger_m2_2 BRIEFING.md, teamwork_preview_challenger_m2_2 DISPATCH.md, teamwork_preview_challenger_m2_2 handoff.md, teamwork_preview_challenger_m2_2 progress.md

### Community 167 - "Minor cluster 167"
Cohesion: 0.50
Nodes (4): Kaj Car Briefing, Kaj Car Dispatch, Kaj Car Handoff Report, Kaj Car Progress Log

### Community 168 - "Minor cluster 168"
Cohesion: 0.50
Nodes (4): M1_1 Briefing, M1_1 Dispatch, M1_1 Startup Defect and Game Loop Handoff, M1_1 Progress Log

### Community 169 - "Minor cluster 169"
Cohesion: 0.50
Nodes (4): M1_2 Briefing, M1_2 Dispatch, M1_2 Spatial Hash Grid Design Handoff, M1_2 Progress Log

### Community 170 - "Minor cluster 170"
Cohesion: 0.50
Nodes (4): M1_3 Briefing, M1_3 Dispatch, M1_3 Testing API and Modular Integration Handoff, M1_3 Progress Log

### Community 171 - "Minor cluster 171"
Cohesion: 0.50
Nodes (4): M2_1 Briefing, M2_1 Dispatch, M2_1 Road Network Design Handoff, M2_1 Progress Log

### Community 172 - "Minor cluster 172"
Cohesion: 0.67
Nodes (3): mount(), draw(), spin()

### Community 173 - "Minor cluster 173"
Cohesion: 0.50
Nodes (4): checkRunOvers, hitPedestrianWithVehicle (car ragdoll launch), stepCarContact / stepPedRagdoll, witnessesReact

### Community 174 - "Minor cluster 174"
Cohesion: 0.50
Nodes (4): initGameAPI automation test hook, Inventory and weapon definitions, selectWeapon, Weapon wheel and weapon HUD

### Community 177 - "Minor cluster 177"
Cohesion: 0.67
Nodes (3): bootLog loading terminal, /mapfinal map loading (AnothermapoLoader usage), showStartButton

### Community 178 - "Minor cluster 178"
Cohesion: 0.67
Nodes (3): obituary.html (Evil Ass Goblin stub), projects.html (JW Pepper download button), myFunction (download mp3 by song number)

### Community 180 - "Minor cluster 180"
Cohesion: 0.67
Nodes (3): alongEdge(), governedEnd(), junctionDegree()

## Ambiguous Edges - Review These
- `Bedroom / care room (bed, lamp, shower, bowl)` → `playBedroomVoiceLine (/api/bedroom-voice TTS)`  [AMBIGUOUS]
  index.html · relation: semantically_similar_to

## Knowledge Gaps
- **158 isolated node(s):** `../money.js`, `Fixed 60Hz timestep loop`, `1000-frame stress benchmark`, `teamwork_preview_challenger_m1_1 BRIEFING.md`, `teamwork_preview_challenger_m1_1 DISPATCH.md` (+153 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1238 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **76 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `three` connect `Minor cluster 67` to `Bar Storefront Textures`, `Net Cops & Replicas`, `Impacts & Character Meshes`, `Air Traffic`, `Minor cluster 132`, `Anothermapo Map Loader`, `IDM & Pure Pursuit AI`, `Car Crashes`, `SpatialGrid Audit Notes`, `Gas Stations`, `Civic Instancing Tests`, `Drugs & Alcohol`, `Pedestrian Spawning`, `Guns & Items`, `Mermaid World Data`, `Disembark Sync Notes`, `Money & Wallet HUD`, `Instanced Fleet (proposed)`, `Vehicle Stress Tests & NetWorld`, `Proposed Map Loader`, `Police Officers`, `Main Loop Audit`, `Fleet Profiling`, `Avatar Poses`, `Car Models`, `Road Signs`, `Vehicle Transitions`, `Environment & Trees`, `Day/Night Cycle`, `Districts`, `Traffic Manager`, `Car Interior & Glass`, `Minor cluster 64`, `Minor cluster 75`, `Minor cluster 76`, `Minor cluster 79`, `Minor cluster 80`, `package.json Deps`, `Minor cluster 85`, `Minor cluster 86`, `Minor cluster 93`, `Minor cluster 97`, `Minor cluster 104`, `Minor cluster 107`, `Minor cluster 124`?**
  _High betweenness centrality (0.460) - this node is a cross-community bridge._
- **What connects `../money.js`, `Fixed 60Hz timestep loop`, `1000-frame stress benchmark` to the rest of the system?**
  _158 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bar Storefront Textures` be split into smaller, more focused modules?**
  _Cohesion score 0.05431515671962216 - nodes in this community are weakly interconnected._
- **Why does `NetReplica` connect `Net Cops & Replicas` to `Vehicle Stress Tests & NetWorld`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `City Nav Baker` be split into smaller, more focused modules?**
  _Cohesion score 0.018018018018018018 - nodes in this community are weakly interconnected._
- **Why does `CivicVehicle (kinematic bicycle + 3-circle capsule collision)` connect `Minor cluster 101` to `Minor cluster 76`, `Minor cluster 102`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Bedroom / care room (bed, lamp, shower, bowl)` and `playBedroomVoiceLine (/api/bedroom-voice TTS)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._