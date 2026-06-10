insert into devices (
  device_id,
  display_name,
  region,
  firmware_version,
  status,
  location
) values
  (
    'edge-ca-001',
    'Los Angeles Ridge Node 1',
    'southern-california',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.2437, 34.0522), 4326)::geography
  ),
  (
    'edge-ca-002',
    'Angeles Forest Node 2',
    'southern-california',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-118.1750, 34.2820), 4326)::geography
  ),
  (
    'edge-ca-003',
    'San Gabriel Wash Node 3',
    'southern-california',
    '0.1.0',
    'online',
    st_setsrid(st_makepoint(-117.8650, 34.1260), 4326)::geography
  )
on conflict (device_id) do nothing;

