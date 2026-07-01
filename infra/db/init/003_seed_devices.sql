-- Generated from db/seeds/devices.json. Do not edit by hand.
--
-- Init scripts run in lexical order, so guard the kind column here as
-- well (004_device_kind.sql is the canonical migration for existing DBs).
alter table devices
  add column if not exists kind text not null default 'ridge';

insert into devices (
  device_id,
  display_name,
  region,
  kind,
  firmware_version,
  status,
  location
) values
  (
    'edge-ca-001',
    'Los Angeles Ridge Node 1',
    'socal',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.2437, 34.0522), 4326)::geography
  ),
  (
    'edge-ca-002',
    'Angeles Forest Node 2',
    'socal',
    'forest',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.175, 34.282), 4326)::geography
  ),
  (
    'edge-ca-003',
    'San Gabriel Wash Node 3',
    'socal',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-117.865, 34.126), 4326)::geography
  ),
  (
    'edge-ca-004',
    'Topanga Canyon Node 4',
    'socal',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.601, 34.094), 4326)::geography
  ),
  (
    'edge-ca-005',
    'Verdugo Hills Node 5',
    'socal',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.286, 34.211), 4326)::geography
  ),
  (
    'edge-ca-006',
    'Sepulveda Basin Node 6',
    'socal',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.482, 34.172), 4326)::geography
  ),
  (
    'edge-ca-007',
    'Whittier Narrows Node 7',
    'socal',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.065, 34.023), 4326)::geography
  ),
  (
    'edge-ca-008',
    'Griffith Park Node 8',
    'socal',
    'forest',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.294, 34.1365), 4326)::geography
  ),
  (
    'edge-ca-009',
    'Santa Anita Ridge Node 9',
    'socal',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.033, 34.181), 4326)::geography
  ),
  (
    'edge-ca-010',
    'Malibu Creek Node 10',
    'socal',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.731, 34.097), 4326)::geography
  ),
  (
    'edge-wa-011',
    'Cougar Mountain Node 11',
    'pnw',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-122.108, 47.543), 4326)::geography
  ),
  (
    'edge-wa-012',
    'Snoqualmie Basin Node 12',
    'pnw',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-121.825, 47.53), 4326)::geography
  ),
  (
    'edge-or-013',
    'Forest Park Node 13',
    'pnw',
    'forest',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-122.772, 45.571), 4326)::geography
  ),
  (
    'edge-or-014',
    'Willamette Bank Node 14',
    'pnw',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-122.669, 45.478), 4326)::geography
  ),
  (
    'edge-wa-015',
    'Tiger Mountain Node 15',
    'pnw',
    'forest',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-121.947, 47.488), 4326)::geography
  ),
  (
    'edge-az-016',
    'South Mountain Node 16',
    'southwest',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-112.083, 33.339), 4326)::geography
  ),
  (
    'edge-az-017',
    'Salt River Node 17',
    'southwest',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-111.94, 33.43), 4326)::geography
  ),
  (
    'edge-az-018',
    'Camelback Node 18',
    'southwest',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-111.962, 33.515), 4326)::geography
  ),
  (
    'edge-az-019',
    'Catalina Foothills Node 19',
    'southwest',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-110.91, 32.318), 4326)::geography
  ),
  (
    'edge-az-020',
    'Rillito Wash Node 20',
    'southwest',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-110.975, 32.275), 4326)::geography
  ),
  (
    'edge-co-021',
    'Flatirons Node 21',
    'rockies',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-105.293, 39.988), 4326)::geography
  ),
  (
    'edge-co-022',
    'Boulder Creek Node 22',
    'rockies',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-105.276, 40.014), 4326)::geography
  ),
  (
    'edge-co-023',
    'Lookout Mountain Node 23',
    'rockies',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-105.238, 39.732), 4326)::geography
  ),
  (
    'edge-co-024',
    'Mount Falcon Node 24',
    'rockies',
    'forest',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-105.24, 39.635), 4326)::geography
  ),
  (
    'edge-co-025',
    'Clear Creek Node 25',
    'rockies',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-105.221, 39.755), 4326)::geography
  ),
  (
    'edge-tx-026',
    'Buffalo Bayou Node 26',
    'gulf',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-95.401, 29.762), 4326)::geography
  ),
  (
    'edge-tx-027',
    'Galveston Bay Node 27',
    'gulf',
    'coastal',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-94.986, 29.552), 4326)::geography
  ),
  (
    'edge-tx-028',
    'Addicks Basin Node 28',
    'gulf',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-95.63, 29.802), 4326)::geography
  ),
  (
    'edge-la-029',
    'Lakefront Node 29',
    'gulf',
    'coastal',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-90.062, 30.03), 4326)::geography
  ),
  (
    'edge-la-030',
    'Bayou St. John Node 30',
    'gulf',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-90.088, 29.975), 4326)::geography
  ),
  (
    'edge-fl-031',
    'Biscayne Shore Node 31',
    'southeast',
    'coastal',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-80.135, 25.774), 4326)::geography
  ),
  (
    'edge-fl-032',
    'Little River Node 32',
    'southeast',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-80.185, 25.85), 4326)::geography
  ),
  (
    'edge-fl-033',
    'Everglades Edge Node 33',
    'southeast',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-80.5, 25.76), 4326)::geography
  ),
  (
    'edge-fl-034',
    'Tampa Bayshore Node 34',
    'southeast',
    'coastal',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-82.48, 27.891), 4326)::geography
  ),
  (
    'edge-fl-035',
    'Hillsborough River Node 35',
    'southeast',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-82.436, 28.029), 4326)::geography
  ),
  (
    'edge-mo-036',
    'Mississippi Confluence Node 36',
    'midwest',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-90.12, 38.81), 4326)::geography
  ),
  (
    'edge-mo-037',
    'Meramec Bank Node 37',
    'midwest',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-90.53, 38.463), 4326)::geography
  ),
  (
    'edge-il-038',
    'Cahokia Bottoms Node 38',
    'midwest',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-90.07, 38.57), 4326)::geography
  ),
  (
    'edge-tn-039',
    'Wolf River Node 39',
    'midwest',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-89.9, 35.18), 4326)::geography
  ),
  (
    'edge-mo-040',
    'Gateway Ridge Node 40',
    'midwest',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-90.23, 38.64), 4326)::geography
  ),
  (
    'edge-ok-041',
    'Canadian Valley Node 41',
    'plains',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-97.64, 35.41), 4326)::geography
  ),
  (
    'edge-ok-042',
    'Moore Plains Node 42',
    'plains',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-97.487, 35.339), 4326)::geography
  ),
  (
    'edge-ok-043',
    'Norman Mesonet Node 43',
    'plains',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-97.464, 35.236), 4326)::geography
  ),
  (
    'edge-ks-044',
    'Arkansas Bend Node 44',
    'plains',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-97.336, 37.687), 4326)::geography
  ),
  (
    'edge-ks-045',
    'Flint Hills Node 45',
    'plains',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-96.8, 37.9), 4326)::geography
  ),
  (
    'edge-ny-046',
    'Hudson Palisades Node 46',
    'northeast',
    'ridge',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-73.955, 40.855), 4326)::geography
  ),
  (
    'edge-ny-047',
    'Jamaica Bay Node 47',
    'northeast',
    'coastal',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-73.82, 40.615), 4326)::geography
  ),
  (
    'edge-nj-048',
    'Meadowlands Node 48',
    'northeast',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-74.07, 40.785), 4326)::geography
  ),
  (
    'edge-ma-049',
    'Charles Basin Node 49',
    'northeast',
    'wash',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-71.085, 42.358), 4326)::geography
  ),
  (
    'edge-ma-050',
    'Blue Hills Node 50',
    'northeast',
    'forest',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-71.114, 42.212), 4326)::geography
  )
on conflict (device_id) do nothing;
