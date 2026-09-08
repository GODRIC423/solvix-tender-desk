-- =====================================================================
-- Solvix Tender Desk - lookup + reference seed data
-- =====================================================================
-- Everything in this file is idempotent (ON CONFLICT DO NOTHING / DO UPDATE)
-- so `supabase db reset` and a re-run against an existing database behave
-- the same way.
-- =====================================================================

-- ---------------------------------------------------------------------
-- org_settings singleton
-- ---------------------------------------------------------------------
insert into public.org_settings (id, qc_bands, urgency_rules, interaction_aging)
values (
  1,
  -- QC confidence bands. Anything below `orange` is red.
  '{"green": 0.90, "yellow": 0.75, "orange": 0.50}'::jsonb,
  -- Two rule sets, chosen by pipeline_stages.is_booked.
  --   unbooked: coloured purely by hours until the pickup is ready.
  --             > 72h out is green.
  --   booked:   red when pickup is within 2h and no tracking event has been
  --             logged, orange within 6h with no tracking event, plus a
  --             separate "nobody has touched this in 24h" flag.
  '{
     "unbooked": {"yellow_hours": 72, "orange_hours": 24, "red_hours": 3},
     "booked":   {"red_hours_no_checkcall": 2,
                  "orange_hours_no_checkcall": 6,
                  "stale_touch_hours": 24}
   }'::jsonb,
  -- Carrier interaction aging windows. Mirrored by v_carrier_recent_interactions.
  '{"recent_days": 30, "caution_days": 365}'::jsonb
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- pipeline_stages
-- ---------------------------------------------------------------------
insert into public.pipeline_stages (key, label, sort_order, is_booked, is_terminal) values
  ('new',               'New',               10, false, false),
  ('qc_review',         'QC Review',         20, false, false),
  ('available',         'Available',         30, false, false),
  ('booked',            'Booked',            40, true,  false),
  ('appointment_set',   'Appointment Set',   50, true,  false),
  ('appointment_ready', 'Appointment Ready', 60, true,  false),
  ('in_transit',        'In Transit',        70, true,  false),
  ('delivered',         'Delivered',         80, true,  false),
  ('pod_received',      'POD Received',      90, true,  false),
  ('invoiced',          'Invoiced',         100, true,  false),
  ('paid',              'Paid',             110, true,  true),
  ('cancelled',         'Cancelled',        120, false, true)
on conflict (key) do update
  set label       = excluded.label,
      sort_order  = excluded.sort_order,
      is_booked   = excluded.is_booked,
      is_terminal = excluded.is_terminal;

-- ---------------------------------------------------------------------
-- flag_types - the "waiting on ..." tags
-- ---------------------------------------------------------------------
insert into public.flag_types (key, label, sort_order) values
  ('rate_confirmation', 'Waiting on Rate Con',       10),
  ('appointment',       'Waiting on Appointment',    20),
  ('approval',          'Waiting on Approval',       30),
  ('pod',               'Waiting on POD',            40),
  ('customer_info',     'Waiting on Customer Info',  50),
  ('carrier_docs',      'Waiting on Carrier Docs',   60),
  ('other',             'Other',                     70)
on conflict (key) do update
  set label = excluded.label, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- interaction_types
-- ---------------------------------------------------------------------
insert into public.interaction_types (key, label, sort_order, severity) values
  ('note',                  'Note',                   10, 'info'),
  ('quick_pay_request',     'Quick Pay Request',      20, 'warn'),
  ('rate_increase_request', 'Rate Increase Request',  30, 'warn'),
  ('equipment_issue',       'Equipment Issue',        40, 'critical'),
  ('service_failure',       'Service Failure',        50, 'critical'),
  ('fell_off_load',         'Fell Off Load',          60, 'critical'),
  ('compliment',            'Compliment',             70, 'info'),
  ('other',                 'Other',                  80, 'info')
on conflict (key) do update
  set label = excluded.label, sort_order = excluded.sort_order, severity = excluded.severity;

-- =====================================================================
-- metros
-- =====================================================================
-- Curated list of the US freight metros a domestic dry-van/reefer brokerage
-- actually quotes. Coordinates are metro-centre approximations to ~1km: they
-- drive metro grouping and the Phase 2 east/west rate-per-mile split, NOT
-- routing or mileage, so this precision is deliberate and sufficient.
--
-- `aliases` are the suburb / satellite city names that should roll up to the
-- metro. Out-of-state suburbs carry their state ('Gary IN') so the resolver
-- can match them without the metro's own state agreeing.
--
-- CBSA codes are best-effort for the larger metros and NULL where a metro in
-- this list is not itself a CBSA (Inland Empire, Palm Springs and Springdale
-- are components of a neighbouring CBSA). Validate against the current
-- OMB/Census delineation before using them as a join key to external data.
-- =====================================================================
insert into public.metros (name, state, cbsa_code, center_lat, center_lon, aliases) values
('Atlanta, GA','GA','12060',33.749000,-84.388000,array['Marietta','Smyrna','Kennesaw','Alpharetta','Duluth','Lawrenceville','Austell','Forest Park','McDonough','Fairburn','Villa Rica','Norcross','Tucker','College Park','Union City','Conyers','Stockbridge','Jonesboro','Douglasville','Cartersville','Newnan','Locust Grove']),
('Chicago, IL','IL','16980',41.878100,-87.629800,array['Elwood','Joliet','Bolingbrook','Romeoville','Naperville','Aurora','Elgin','Schaumburg','Bedford Park','Cicero','Melrose Park','Des Plaines','University Park','Gary IN','Hammond IN','Portage IN','Franklin Park','Addison','Itasca','Wheeling']),
('Dallas-Fort Worth, TX','TX','19100',32.776700,-96.797000,array['Dallas','Fort Worth','Arlington','Irving','Grand Prairie','Garland','Mesquite','Plano','Lancaster','Wilmer','Hutchins','Haslet','Coppell','Carrollton','Denton','Waxahachie','Alliance','DFW']),
('Los Angeles, CA','CA','31080',34.052200,-118.243700,array['Long Beach','Carson','Compton','Vernon','Commerce','City of Industry','Santa Fe Springs','San Pedro','Torrance','Gardena','Paramount','La Mirada','Pico Rivera','Norwalk','Cerritos','Wilmington CA','Van Nuys','Sylmar','Valencia','Santa Clarita']),
('Inland Empire, CA','CA',null,34.000000,-117.300000,array['Riverside','San Bernardino','Ontario','Fontana','Rancho Cucamonga','Moreno Valley','Perris','Redlands','Chino','Mira Loma','Jurupa Valley','Corona','Bloomington','Rialto','Colton','Beaumont','Eastvale','Norco','Temecula','Murrieta','Victorville','Hesperia']),
('Houston, TX','TX','26420',29.760400,-95.369800,array['Pasadena TX','Baytown','Katy','Sugar Land','Stafford','Channelview','La Porte','Deer Park','Conroe','Spring','Humble','Rosenberg','Galena Park','Missouri City','Pearland','Texas City','Freeport']),
('Memphis, TN','TN','32820',35.149500,-90.049000,array['Southaven','Olive Branch','Horn Lake','Bartlett','Collierville','Millington','West Memphis','Arlington TN','Marion AR']),
('Indianapolis, IN','IN','26900',39.768400,-86.158100,array['Plainfield','Greenwood','Whitestown','Lebanon IN','Franklin IN','Anderson','Avon','Brownsburg','Mooresville','Greenfield','Shelbyville','Zionsville']),
('Columbus, OH','OH','18140',39.961200,-82.998800,array['Groveport','Obetz','Grove City','Etna','Pataskala','Lockbourne','Dublin OH','West Jefferson','Marysville','Newark OH','Reynoldsburg','Hilliard']),
('Harrisburg, PA','PA','25420',40.273200,-76.886700,array['Carlisle','Mechanicsburg','Camp Hill','Hershey','Middletown PA','York PA','Lancaster PA','Chambersburg','Shippensburg','New Cumberland','Grantville']),
('Newark/New York, NJ','NJ','35620',40.735700,-74.172400,array['Newark','New York','Elizabeth','Jersey City','Kearny','Secaucus','Carteret','Edison','Perth Amboy','Bayonne','Linden','South Kearny','Port Newark','Bronx','Brooklyn','Queens','Staten Island','Avenel','Rahway','Cranbury','Piscataway','Woodbridge']),
('Savannah, GA','GA','42340',32.080900,-81.091200,array['Port Wentworth','Garden City','Pooler','Rincon','Ellabell','Bloomingdale','Hardeeville']),
('Charlotte, NC','NC','16740',35.227100,-80.843100,array['Concord','Gastonia','Huntersville','Monroe NC','Rock Hill','Fort Mill','Mooresville NC','Salisbury NC','Statesville','Kannapolis','Indian Trail']),
('Nashville, TN','TN','34980',36.162700,-86.781600,array['Lebanon TN','Murfreesboro','Smyrna TN','La Vergne','Franklin TN','Mount Juliet','Gallatin','Antioch','Hermitage','Portland TN','Dickson']),
('Kansas City, MO','MO','28140',39.099700,-94.578600,array['Kansas City KS','Olathe','Lenexa','Overland Park','Edgerton','Riverside MO','Liberty MO','Independence MO','Gardner','Grandview','Lees Summit','Belton']),
('Denver, CO','CO','19740',39.739200,-104.990300,array['Aurora CO','Commerce City','Brighton','Henderson CO','Golden','Lakewood','Englewood','Thornton','Longmont','Boulder','Littleton']),
('Phoenix, AZ','AZ','38060',33.448400,-112.074000,array['Tolleson','Goodyear','Buckeye','Glendale AZ','Mesa','Tempe','Chandler','Avondale','Surprise','Peoria AZ','Gilbert','Scottsdale','Casa Grande']),
('Salt Lake City, UT','UT','41620',40.760800,-111.891000,array['West Valley City','Draper','Sandy UT','Tooele','West Jordan','Murray','Midvale','South Salt Lake','Bluffdale']),
('Seattle, WA','WA','42660',47.606200,-122.332100,array['Tacoma','Kent','Auburn WA','Sumner','Fife','Renton','Everett','Lakewood WA','DuPont','Redmond WA','Federal Way','Puyallup','Marysville WA']),
('Portland, OR','OR','38900',45.515200,-122.678400,array['Gresham','Hillsboro','Beaverton','Wilsonville','Troutdale','Vancouver WA','Clackamas','Tualatin','Fairview OR']),
('Oakland, CA','CA','41860',37.804400,-122.271200,array['San Francisco','Richmond CA','Hayward','Fremont','San Leandro','Union City CA','Newark CA','Livermore','Tracy','San Jose','Milpitas','Pleasanton','Benicia','Vallejo','Napa','Concord CA']),
('Stockton, CA','CA','44700',37.957700,-121.290800,array['Lathrop','Manteca','Modesto','Patterson CA','Turlock','Lodi','Ripon','Merced','Ceres']),
('Laredo, TX','TX','29700',27.506400,-99.507500,array['Nuevo Laredo','Colombia','Rio Bravo TX']),
('El Paso, TX','TX','21340',31.761900,-106.485000,array['Santa Teresa','Anthony TX','Socorro TX','Ciudad Juarez','Sunland Park']),
('Miami, FL','FL','33100',25.761700,-80.191800,array['Hialeah','Doral','Medley','Opa-locka','Fort Lauderdale','Pompano Beach','Miramar','Hollywood FL','West Palm Beach','Homestead','Davie','Deerfield Beach','Boca Raton','Riviera Beach']),
('Orlando, FL','FL','36740',28.538300,-81.379200,array['Kissimmee','Winter Garden','Sanford','Apopka','Ocoee','Lake Mary','Longwood','Altamonte Springs','Davenport FL']),
('Jacksonville, FL','FL','27260',30.332200,-81.655700,array['Orange Park','Green Cove Springs','Yulee','Callahan','Middleburg','Baldwin FL']),
('Minneapolis, MN','MN','33460',44.977800,-93.265000,array['St. Paul','Saint Paul','Eagan','Rogers MN','Shakopee','Bloomington MN','Brooklyn Park','Maple Grove','Lakeville','Chaska','Anoka']),
('Detroit, MI','MI','19820',42.331400,-83.045800,array['Romulus','Taylor MI','Warren MI','Dearborn','Livonia','Sterling Heights','Ann Arbor','Pontiac','Auburn Hills','Southfield','Wixom','Belleville MI','Monroe MI']),
('Cleveland, OH','OH','17460',41.499300,-81.694400,array['Twinsburg','Solon','Strongsville','Macedonia','North Ridgeville','Lorain','Elyria','Mentor','Westlake','Bedford Heights']),
('Cincinnati, OH','OH','17140',39.103100,-84.512000,array['Hebron KY','Florence KY','West Chester OH','Monroe OH','Sharonville','Erlanger','Covington KY','Fairfield OH','Mason OH','Wilder KY']),
('St. Louis, MO','MO','41180',38.627000,-90.199400,array['Earth City','Hazelwood','Maryland Heights','Edwardsville IL','Granite City','OFallon','St. Charles','Saint Charles','Fenton MO','Wentzville','Collinsville IL']),
('Milwaukee, WI','WI','33340',43.038900,-87.906500,array['Oak Creek','Franklin WI','Racine','Kenosha','Waukesha','New Berlin','Menomonee Falls','Pleasant Prairie','West Allis']),
('Oklahoma City, OK','OK','36420',35.467600,-97.516400,array['Moore','Norman','Edmond','Yukon','Midwest City','El Reno','Shawnee OK']),
('San Antonio, TX','TX','41700',29.424100,-98.493600,array['Schertz','New Braunfels','Selma TX','Converse','Seguin','Cibolo','Universal City']),
('Austin, TX','TX','12420',30.267200,-97.743100,array['Round Rock','San Marcos','Georgetown TX','Pflugerville','Buda','Kyle','Cedar Park','Hutto','Taylor TX']),
('New Orleans, LA','LA','35380',29.951100,-90.071500,array['Kenner','Metairie','Harahan','Gretna','Slidell','Chalmette','Marrero','Laplace']),
('Birmingham, AL','AL','13820',33.518600,-86.810400,array['Bessemer','Hoover','Pelham','Trussville','Leeds AL','McCalla','Alabaster','Calera']),
('Louisville, KY','KY','31140',38.252700,-85.758500,array['Jeffersonville IN','Shepherdsville','Clarksville IN','New Albany IN','Elizabethtown KY','Sellersburg','Bardstown']),
('Richmond, VA','VA','40060',37.540700,-77.436000,array['Petersburg','Ashland VA','Chester VA','Colonial Heights','Mechanicsville','Sandston','Prince George VA']),
('Baltimore, MD','MD','12580',39.290400,-76.612200,array['Elkridge','Jessup','Sparrows Point','Curtis Bay','Dundalk','Hanover MD','Columbia MD','Glen Burnie','Aberdeen','Belcamp','Havre de Grace']),
('Washington, DC','DC','47900',38.907200,-77.036900,array['Alexandria VA','Arlington VA','Manassas','Springfield VA','Landover','Capitol Heights','Sterling VA','Chantilly','Woodbridge VA','Upper Marlboro','Frederick MD','Winchester VA']),
('Boston, MA','MA','14460',42.360100,-71.058900,array['Chelsea MA','Everett MA','Braintree','Woburn','Franklin MA','Taunton','Worcester','Norwood','Wilmington MA','Canton MA','Devens','Westborough']),
('Buffalo, NY','NY','15380',42.886400,-78.878400,array['Cheektowaga','Tonawanda','Lackawanna','Niagara Falls','Lancaster NY','Depew','Amherst NY']),
('Pittsburgh, PA','PA','38300',40.440600,-79.995900,array['Monroeville','Cranberry Township','McKeesport','Washington PA','New Stanton','Coraopolis','Butler PA','Greensburg']),
('Philadelphia, PA','PA','37980',39.952600,-75.165200,array['Camden NJ','Bensalem','King of Prussia','Chester PA','Pennsauken','Bristol PA','Norristown','Swedesboro','Logan Township','Burlington NJ','West Deptford']),
('Reno, NV','NV','39900',39.529600,-119.813800,array['Sparks','Fernley','McCarran','Carson City','Silver Springs NV']),
('Las Vegas, NV','NV','29820',36.169900,-115.139800,array['North Las Vegas','Henderson NV','Sloan','Boulder City']),
('Boise, ID','ID','14260',43.615000,-116.202300,array['Nampa','Caldwell','Meridian ID','Garden City ID','Kuna']),
('Spokane, WA','WA','44060',47.658800,-117.426000,array['Spokane Valley','Airway Heights','Post Falls','Coeur dAlene','Liberty Lake']),
('Albuquerque, NM','NM','10740',35.084400,-106.650400,array['Rio Rancho','Los Lunas','Bernalillo','Belen']),
('Tulsa, OK','OK','46140',36.154000,-95.992800,array['Broken Arrow','Catoosa','Sand Springs','Owasso','Claremore','Muskogee']),
('Little Rock, AR','AR','30780',34.746500,-92.289600,array['North Little Rock','Conway AR','Benton AR','Bryant','Jacksonville AR']),
('Jackson, MS','MS','27140',32.298800,-90.184800,array['Pearl MS','Ridgeland','Byram','Clinton MS','Richland MS','Flowood','Madison MS']),
('Greensboro, NC','NC','24660',36.072600,-79.792000,array['High Point','Winston-Salem','Kernersville','Burlington NC','Thomasville NC','Archdale','Mebane']),
('Raleigh, NC','NC','39580',35.779600,-78.638200,array['Durham','Cary','Garner','Clayton NC','Apex','Smithfield NC','Research Triangle Park','Morrisville','Youngsville','Wake Forest']),
('Greenville, SC','SC','24860',34.852600,-82.394000,array['Spartanburg','Anderson SC','Duncan SC','Greer','Easley','Fountain Inn','Simpsonville','Piedmont SC','Gaffney']),
('Knoxville, TN','TN','28940',35.960600,-83.920700,array['Alcoa','Maryville TN','Sevierville','Lenoir City','Oak Ridge','Morristown']),
('Chattanooga, TN','TN','16860',35.045600,-85.309700,array['East Ridge','Cleveland TN','Dalton GA','Ringgold GA','Ooltewah','Fort Oglethorpe']),
('Lexington, KY','KY','30460',38.040600,-84.503700,array['Georgetown KY','Nicholasville','Winchester KY','Frankfort KY','Richmond KY','Versailles KY']),
('Toledo, OH','OH','45780',41.652800,-83.537900,array['Perrysburg','Maumee','Northwood OH','Bowling Green OH','Rossford','Findlay']),
('Grand Rapids, MI','MI','24340',42.963400,-85.668100,array['Wyoming MI','Kentwood','Holland MI','Grandville','Walker MI','Zeeland','Byron Center','Muskegon']),
('Des Moines, IA','IA','19780',41.586800,-93.625000,array['West Des Moines','Ankeny','Altoona IA','Urbandale','Grimes','Johnston','Waukee']),
('Omaha, NE','NE','36540',41.256500,-95.934500,array['Council Bluffs','Bellevue NE','Papillion','La Vista','Gretna NE','Fremont NE']),
('Wichita, KS','KS','48620',37.687200,-97.330100,array['Park City KS','Derby KS','Newton KS','Andover KS','El Dorado KS']),
('Sioux Falls, SD','SD','43620',43.546000,-96.731300,array['Brandon SD','Harrisburg SD','Tea SD','Dell Rapids']),
('Fargo, ND','ND','22020',46.877200,-96.789800,array['West Fargo','Moorhead','Dilworth','Grand Forks']),
('Billings, MT','MT','13740',45.783300,-108.500700,array['Laurel MT','Lockwood MT']),
('Casper, WY','WY','16220',42.866600,-106.313100,array['Evansville WY','Mills WY','Douglas WY']),
('Fresno, CA','CA','23420',36.737800,-119.787100,array['Clovis','Madera','Selma CA','Kingsburg','Visalia','Tulare','Sanger','Reedley']),
('Bakersfield, CA','CA','12540',35.373300,-119.018700,array['Shafter','Delano','Wasco','Tehachapi','Taft','Arvin','McFarland']),
('Sacramento, CA','CA','40900',38.581600,-121.494400,array['West Sacramento','Elk Grove','Roseville','Rocklin','Woodland CA','Davis','Lincoln CA','Citrus Heights','Yuba City']),
('San Diego, CA','CA','41740',32.715700,-117.161100,array['Otay Mesa','Chula Vista','National City','Escondido','Oceanside','Vista CA','Carlsbad','San Marcos CA','Poway']),
('Tucson, AZ','AZ','46060',32.222600,-110.974700,array['Marana','Oro Valley','Nogales AZ','Sahuarita','Green Valley AZ']),
('Amarillo, TX','TX','11100',35.222000,-101.831300,array['Canyon TX','Dumas TX','Hereford TX']),
('Lubbock, TX','TX','31180',33.577900,-101.855200,array['Plainview TX','Levelland','Slaton']),
('Corpus Christi, TX','TX','18580',27.800600,-97.396400,array['Robstown','Portland TX','Ingleside','Aransas Pass','Kingsville']),
('McAllen, TX','TX','32580',26.203400,-98.230000,array['Pharr','Hidalgo','Edinburg','Mission TX','Brownsville','Harlingen','Weslaco','San Juan TX','Donna']),
('Shreveport, LA','LA','43340',32.525200,-93.750200,array['Bossier City','Minden LA','Stonewall LA']),
('Baton Rouge, LA','LA','12940',30.451500,-91.187100,array['Port Allen','Gonzales LA','Zachary','Denham Springs','Plaquemine','Prairieville']),
('Mobile, AL','AL','33660',30.695400,-88.039900,array['Theodore','Saraland','Daphne','Fairhope','Bay Minette','Chickasaw']),
('Tampa, FL','FL','45300',27.950600,-82.457200,array['St. Petersburg','Saint Petersburg','Clearwater','Plant City','Brandon FL','Tarpon Springs','Riverview','Largo','Palmetto FL','Ruskin']),
('Fort Myers, FL','FL','15980',26.640600,-81.872300,array['Cape Coral','Naples','Bonita Springs','Estero','Punta Gorda','Immokalee']),
('Charleston, SC','SC','16700',32.776500,-79.931100,array['North Charleston','Summerville','Ladson','Goose Creek','Moncks Corner','Mount Pleasant','Ridgeville']),
('Columbia, SC','SC','17900',34.000700,-81.034800,array['West Columbia','Cayce','Lexington SC','Blythewood','Orangeburg','Irmo','Sumter']),
('Augusta, GA','GA','12260',33.473500,-81.974800,array['North Augusta','Grovetown','Evans GA','Aiken','Martinez GA','Graniteville']),
('Macon, GA','GA','31420',32.840700,-83.632400,array['Warner Robins','Byron GA','Perry GA','Forsyth GA','Milledgeville']),
('Huntsville, AL','AL','26620',34.730400,-86.586100,array['Madison AL','Decatur AL','Athens AL','Cullman']),
('Montgomery, AL','AL','33860',32.366800,-86.300000,array['Prattville','Millbrook AL','Wetumpka','Selma AL']),
('Tupelo, MS','MS','46180',34.257600,-88.703400,array['Saltillo MS','Verona MS','New Albany MS','Corinth MS']),
('Springfield, MO','MO','44180',37.208900,-93.292300,array['Nixa','Ozark MO','Republic MO','Strafford','Bolivar MO']),
('Joplin, MO','MO','27900',37.084200,-94.513300,array['Carthage MO','Webb City','Neosho','Carl Junction']),
('Topeka, KS','KS','45820',39.047300,-95.675200,array['Lawrence KS','Ozawkie','Holton KS']),
('Lincoln, NE','NE','30700',40.813600,-96.702600,array['Waverly NE','Crete NE','Seward NE','York NE']),
('Cedar Rapids, IA','IA','16300',41.977900,-91.665600,array['Iowa City','Marion IA','Coralville','Hiawatha','North Liberty']),
('Rockford, IL','IL','40420',42.271100,-89.094000,array['Loves Park','Machesney Park','Belvidere','Freeport IL','DeKalb']),
('Peoria, IL','IL','37900',40.693600,-89.589000,array['East Peoria','Pekin','Morton IL','Washington IL','Canton IL']),
('Champaign, IL','IL','16580',40.116400,-88.243400,array['Urbana','Rantoul','Savoy IL','Danville IL','Mahomet']),
('Evansville, IN','IN','21780',37.971600,-87.571100,array['Henderson KY','Newburgh IN','Mount Vernon IN','Boonville IN','Princeton IN']),
('Fort Wayne, IN','IN','23060',41.079300,-85.139400,array['New Haven IN','Huntington IN','Auburn IN','Columbia City','Warsaw IN']),
('South Bend, IN','IN','43780',41.676400,-86.252000,array['Mishawaka','Elkhart','Goshen IN','Niles MI','Bremen IN']),
('Dayton, OH','OH','19430',39.758900,-84.191600,array['Vandalia','Springfield OH','Miamisburg','Huber Heights','Moraine','Troy OH','Sidney OH']),
('Akron, OH','OH','10420',41.081400,-81.519000,array['Canton OH','Barberton','Cuyahoga Falls','Massillon','Stow','North Canton','Wooster']),
('Erie, PA','PA','21500',42.129200,-80.085100,array['Meadville','Girard PA','Corry']),
('Scranton, PA','PA','42540',41.409000,-75.662400,array['Wilkes-Barre','Pittston','Hazleton','Dunmore','Moosic','Jessup PA','Nanticoke']),
('Allentown, PA','PA','10900',40.608400,-75.490200,array['Bethlehem PA','Easton PA','Breinigsville','Fogelsville','Macungie','Bath PA','Nazareth PA']),
('Syracuse, NY','NY','45060',43.048100,-76.147400,array['Liverpool NY','Cicero NY','Auburn NY','Utica','Rome NY','Oswego']),
('Rochester, NY','NY','40380',43.156600,-77.608800,array['Henrietta','Greece NY','Batavia NY','Webster NY','Fairport']),
('Albany, NY','NY','10580',42.652600,-73.756200,array['Schenectady','Troy NY','Rotterdam','Colonie','Latham','Amsterdam NY','Glens Falls']),
('Hartford, CT','CT','25540',41.765800,-72.673400,array['New Britain','East Hartford','Windsor CT','Enfield','Bristol CT','Wallingford','Cheshire CT','Meriden']),
('Providence, RI','RI','39300',41.824000,-71.412800,array['Pawtucket','Warwick','Cranston','Fall River','New Bedford','Woonsocket','Attleboro']),
('Portland, ME','ME','38860',43.659100,-70.256800,array['South Portland','Westbrook','Scarborough ME','Lewiston','Auburn ME','Biddeford']),
('Manchester, NH','NH','31700',42.995600,-71.454800,array['Nashua','Concord NH','Hooksett','Londonderry','Salem NH']),
('Burlington, VT','VT','15540',44.475900,-73.212100,array['South Burlington','Colchester VT','Essex Junction','Williston VT']),
('Wilmington, DE','DE',null,39.739100,-75.539800,array['New Castle DE','Newark DE','Middletown DE','Bear DE','Dover DE']),
('Norfolk, VA','VA','47260',36.850800,-76.285900,array['Virginia Beach','Chesapeake','Portsmouth VA','Suffolk','Hampton','Newport News','Williamsburg']),
('Roanoke, VA','VA','40220',37.271000,-79.941400,array['Salem VA','Vinton','Lynchburg','Blacksburg','Christiansburg']),
('Charleston, WV','WV','16620',38.349800,-81.632600,array['South Charleston','Huntington WV','Nitro','Dunbar WV','Parkersburg']),
('Asheville, NC','NC','11700',35.595100,-82.551500,array['Hendersonville NC','Arden','Fletcher NC','Weaverville','Candler']),
('Wilmington, NC','NC','48900',34.225700,-77.944700,array['Leland NC','Castle Hayne','Jacksonville NC','Burgaw','Shallotte']),
('Ocala, FL','FL','36100',29.187200,-82.140100,array['Belleview','Silver Springs','Dunnellon','Gainesville FL']),
('Lakeland, FL','FL','29460',28.039500,-81.949800,array['Winter Haven','Bartow','Auburndale','Haines City','Mulberry FL']),
('Pensacola, FL','FL','37860',30.421300,-87.216900,array['Milton FL','Gulf Breeze','Cantonment','Pace FL','Crestview']),
('Tallahassee, FL','FL','45220',30.438300,-84.280700,array['Quincy FL','Crawfordville','Havana FL','Monticello FL']),
('Gulfport, MS','MS','25060',30.367400,-89.092800,array['Biloxi','Pascagoula','Ocean Springs','Long Beach MS','Bay St. Louis','Moss Point']),
('Alexandria, LA','LA','10780',31.311300,-92.445100,array['Pineville LA','Ball LA','Marksville']),
('Texarkana, TX','TX','45500',33.425100,-94.047700,array['Texarkana AR','New Boston TX','Atlanta TX','Hope AR']),
('Fayetteville, AR','AR','22220',36.082200,-94.171900,array['Rogers AR','Bentonville','Lowell AR','Siloam Springs']),
('Springdale, AR','AR',null,36.186700,-94.128800,array['Tontitown','Johnson AR','Elm Springs']),
('Rapid City, SD','SD','39660',44.080500,-103.231000,array['Box Elder SD','Spearfish','Sturgis SD']),
('Bismarck, ND','ND','13900',46.808300,-100.783700,array['Mandan','Lincoln ND','Minot']),
('Great Falls, MT','MT','24500',47.505300,-111.300800,array['Black Eagle','Havre MT','Shelby MT']),
('Missoula, MT','MT','33540',46.872100,-113.994000,array['Lolo','Frenchtown MT','Hamilton MT','Kalispell']),
('Idaho Falls, ID','ID','26820',43.491700,-112.034100,array['Ammon','Rexburg','Rigby','Shelley ID']),
('Pocatello, ID','ID','38540',42.871300,-112.445500,array['Chubbuck','Blackfoot','American Falls']),
('Ogden, UT','UT','36260',41.223000,-111.973800,array['Layton','Clearfield','Roy UT','Brigham City','Farmington UT','Kaysville','Logan UT']),
('Provo, UT','UT','39340',40.233800,-111.658500,array['Orem','Springville','Spanish Fork','Lehi','American Fork','Payson UT']),
('Grand Junction, CO','CO','24300',39.063900,-108.550600,array['Fruita','Clifton CO','Palisade CO','Montrose CO']),
('Colorado Springs, CO','CO','17820',38.833900,-104.821400,array['Fountain CO','Monument CO','Manitou Springs','Woodland Park']),
('Pueblo, CO','CO','39380',38.254400,-104.609100,array['Pueblo West','Canon City','Trinidad CO']),
('Santa Fe, NM','NM','42140',35.687000,-105.937800,array['Espanola','Los Alamos','Pojoaque']),
('Flagstaff, AZ','AZ','22380',35.198300,-111.651300,array['Winslow AZ','Williams AZ','Bellemont','Page AZ']),
('Yuma, AZ','AZ','49740',32.692700,-114.627700,array['San Luis AZ','Somerton','Wellton']),
('Palm Springs, CA','CA',null,33.830300,-116.545300,array['Indio','Coachella','Cathedral City','Palm Desert','La Quinta','Thermal']),
('Santa Maria, CA','CA','42200',34.953000,-120.435700,array['Lompoc','Santa Barbara','Guadalupe CA','Buellton','Goleta']),
('San Luis Obispo, CA','CA','42020',35.282800,-120.659600,array['Paso Robles','Atascadero','Pismo Beach','Arroyo Grande','Templeton CA']),
('Salinas, CA','CA','41500',36.677700,-121.655500,array['Monterey','Gonzales CA','Watsonville','Castroville','King City','Soledad','Greenfield CA']),
('Santa Rosa, CA','CA','42220',38.440400,-122.714100,array['Petaluma','Rohnert Park','Windsor CA','Healdsburg','Sebastopol','Ukiah']),
('Redding, CA','CA','39820',40.586500,-122.391700,array['Anderson CA','Red Bluff','Chico','Shasta Lake']),
('Eugene, OR','OR','21660',44.052100,-123.086800,array['Springfield OR','Coburg','Junction City OR','Corvallis','Albany OR','Salem OR']),
('Medford, OR','OR','32780',42.326500,-122.875600,array['Central Point','White City','Grants Pass','Ashland OR','Roseburg']),
('Yakima, WA','WA','49420',46.602100,-120.505900,array['Union Gap','Selah','Sunnyside WA','Toppenish','Wenatchee','Ellensburg']),
('Tri-Cities, WA','WA','28420',46.239600,-119.100600,array['Kennewick','Pasco','Richland WA','Wallula','Walla Walla','Moses Lake','Othello WA']),
('Bend, OR','OR','13460',44.058200,-121.315300,array['Redmond OR','Prineville','Madras OR','La Pine'])
on conflict (name) do update
  set state      = excluded.state,
      cbsa_code  = excluded.cbsa_code,
      center_lat = excluded.center_lat,
      center_lon = excluded.center_lon,
      aliases    = excluded.aliases;

-- =====================================================================
-- metro_zip_map
-- =====================================================================
-- !! CURATED PHASE 1 APPROXIMATION !!
--
-- These are hand-assembled 3-digit ZIP prefixes for the metros above. A zip3
-- prefix is NOT a clean subdivision of a metro area: several prefixes straddle
-- two metros, and a few metros share one. Where the split actually costs us a
-- lane (Laredo inside 780, Yuma inside 853, Santa Maria inside 934) the busier
-- metro keeps the zip3 and the smaller one is carved out with explicit zip5
-- rows, which win in resolve_metro().
--
-- Expect roughly metro-level accuracy, not ZIP-level accuracy. This table is
-- intended to be REPLACED wholesale by the full HUD USPS ZIP <-> CBSA
-- crosswalk (huduser.gov/portal/datasets/usps_crosswalk.html) once we license
-- it; at that point the seed below becomes a fallback for ZIPs the crosswalk
-- does not cover. Do not build billing or tax logic on these values.
-- =====================================================================
insert into public.metro_zip_map (zip3, metro_id)
select z.zip3, m.id
from (values
  -- Southeast
  ('300','Atlanta, GA'),('301','Atlanta, GA'),('302','Atlanta, GA'),('303','Atlanta, GA'),
  ('305','Atlanta, GA'),('306','Atlanta, GA'),
  ('308','Augusta, GA'),('309','Augusta, GA'),
  ('310','Macon, GA'),('312','Macon, GA'),
  ('313','Savannah, GA'),('314','Savannah, GA'),
  ('320','Jacksonville, FL'),('322','Jacksonville, FL'),
  ('323','Tallahassee, FL'),
  ('325','Pensacola, FL'),
  ('327','Orlando, FL'),('328','Orlando, FL'),('329','Orlando, FL'),('347','Orlando, FL'),
  ('330','Miami, FL'),('331','Miami, FL'),('332','Miami, FL'),('333','Miami, FL'),('334','Miami, FL'),
  ('335','Tampa, FL'),('336','Tampa, FL'),('337','Tampa, FL'),('346','Tampa, FL'),
  ('338','Lakeland, FL'),
  ('339','Fort Myers, FL'),('341','Fort Myers, FL'),
  ('344','Ocala, FL'),
  ('350','Birmingham, AL'),('351','Birmingham, AL'),('352','Birmingham, AL'),
  ('356','Huntsville, AL'),('358','Huntsville, AL'),
  ('360','Montgomery, AL'),('361','Montgomery, AL'),
  ('365','Mobile, AL'),('366','Mobile, AL'),
  ('370','Nashville, TN'),('371','Nashville, TN'),('372','Nashville, TN'),
  ('373','Chattanooga, TN'),('374','Chattanooga, TN'),
  ('377','Knoxville, TN'),('378','Knoxville, TN'),('379','Knoxville, TN'),
  ('380','Memphis, TN'),('381','Memphis, TN'),('386','Memphis, TN'),
  ('388','Tupelo, MS'),
  ('390','Jackson, MS'),('391','Jackson, MS'),('392','Jackson, MS'),
  ('395','Gulfport, MS'),
  -- Carolinas / Virginia / Appalachia
  ('270','Greensboro, NC'),('271','Greensboro, NC'),('272','Greensboro, NC'),
  ('275','Raleigh, NC'),('276','Raleigh, NC'),('277','Raleigh, NC'),
  ('280','Charlotte, NC'),('281','Charlotte, NC'),('282','Charlotte, NC'),('297','Charlotte, NC'),
  ('284','Wilmington, NC'),
  ('287','Asheville, NC'),('288','Asheville, NC'),
  ('290','Columbia, SC'),('291','Columbia, SC'),
  ('293','Greenville, SC'),('296','Greenville, SC'),
  ('294','Charleston, SC'),
  ('230','Richmond, VA'),('231','Richmond, VA'),('232','Richmond, VA'),
  ('233','Norfolk, VA'),('234','Norfolk, VA'),('235','Norfolk, VA'),('236','Norfolk, VA'),('237','Norfolk, VA'),
  ('240','Roanoke, VA'),('241','Roanoke, VA'),('245','Roanoke, VA'),
  ('250','Charleston, WV'),('251','Charleston, WV'),('252','Charleston, WV'),('253','Charleston, WV'),
  ('255','Charleston, WV'),('257','Charleston, WV'),
  -- Mid-Atlantic / Northeast
  ('200','Washington, DC'),('202','Washington, DC'),('203','Washington, DC'),('204','Washington, DC'),
  ('205','Washington, DC'),('207','Washington, DC'),('208','Washington, DC'),('209','Washington, DC'),
  ('220','Washington, DC'),('221','Washington, DC'),('222','Washington, DC'),('223','Washington, DC'),
  ('210','Baltimore, MD'),('211','Baltimore, MD'),('212','Baltimore, MD'),('214','Baltimore, MD'),
  ('197','Wilmington, DE'),('198','Wilmington, DE'),('199','Wilmington, DE'),
  ('190','Philadelphia, PA'),('191','Philadelphia, PA'),('193','Philadelphia, PA'),('194','Philadelphia, PA'),
  ('080','Philadelphia, PA'),('081','Philadelphia, PA'),('082','Philadelphia, PA'),('083','Philadelphia, PA'),
  ('170','Harrisburg, PA'),('171','Harrisburg, PA'),('172','Harrisburg, PA'),('173','Harrisburg, PA'),
  ('174','Harrisburg, PA'),('175','Harrisburg, PA'),('176','Harrisburg, PA'),('177','Harrisburg, PA'),
  ('180','Allentown, PA'),('181','Allentown, PA'),
  ('184','Scranton, PA'),('185','Scranton, PA'),('186','Scranton, PA'),('187','Scranton, PA'),('188','Scranton, PA'),
  ('150','Pittsburgh, PA'),('151','Pittsburgh, PA'),('152','Pittsburgh, PA'),('153','Pittsburgh, PA'),
  ('154','Pittsburgh, PA'),('155','Pittsburgh, PA'),('156','Pittsburgh, PA'),
  ('164','Erie, PA'),('165','Erie, PA'),
  ('070','Newark/New York, NJ'),('071','Newark/New York, NJ'),('072','Newark/New York, NJ'),
  ('073','Newark/New York, NJ'),('074','Newark/New York, NJ'),('075','Newark/New York, NJ'),
  ('076','Newark/New York, NJ'),('077','Newark/New York, NJ'),('078','Newark/New York, NJ'),
  ('079','Newark/New York, NJ'),('088','Newark/New York, NJ'),('089','Newark/New York, NJ'),
  ('100','Newark/New York, NJ'),('101','Newark/New York, NJ'),('102','Newark/New York, NJ'),
  ('103','Newark/New York, NJ'),('104','Newark/New York, NJ'),('110','Newark/New York, NJ'),
  ('111','Newark/New York, NJ'),('112','Newark/New York, NJ'),('113','Newark/New York, NJ'),
  ('114','Newark/New York, NJ'),('116','Newark/New York, NJ'),
  ('120','Albany, NY'),('121','Albany, NY'),('122','Albany, NY'),('123','Albany, NY'),
  ('130','Syracuse, NY'),('131','Syracuse, NY'),('132','Syracuse, NY'),
  ('140','Buffalo, NY'),('141','Buffalo, NY'),('142','Buffalo, NY'),('143','Buffalo, NY'),
  ('144','Rochester, NY'),('145','Rochester, NY'),('146','Rochester, NY'),
  ('015','Boston, MA'),('016','Boston, MA'),('017','Boston, MA'),('018','Boston, MA'),('019','Boston, MA'),
  ('020','Boston, MA'),('021','Boston, MA'),('022','Boston, MA'),('023','Boston, MA'),('024','Boston, MA'),
  ('027','Providence, RI'),('028','Providence, RI'),('029','Providence, RI'),
  ('060','Hartford, CT'),('061','Hartford, CT'),('062','Hartford, CT'),('064','Hartford, CT'),('065','Hartford, CT'),
  ('030','Manchester, NH'),('031','Manchester, NH'),('032','Manchester, NH'),('033','Manchester, NH'),
  ('034','Manchester, NH'),('038','Manchester, NH'),
  ('040','Portland, ME'),('041','Portland, ME'),('042','Portland, ME'),('043','Portland, ME'),
  ('054','Burlington, VT'),('056','Burlington, VT'),
  -- Midwest
  ('430','Columbus, OH'),('431','Columbus, OH'),('432','Columbus, OH'),('433','Columbus, OH'),
  ('434','Toledo, OH'),('435','Toledo, OH'),('436','Toledo, OH'),
  ('440','Cleveland, OH'),('441','Cleveland, OH'),
  ('442','Akron, OH'),('443','Akron, OH'),('446','Akron, OH'),('447','Akron, OH'),
  ('450','Cincinnati, OH'),('451','Cincinnati, OH'),('452','Cincinnati, OH'),('410','Cincinnati, OH'),
  ('453','Dayton, OH'),('454','Dayton, OH'),('455','Dayton, OH'),
  ('460','Indianapolis, IN'),('461','Indianapolis, IN'),('462','Indianapolis, IN'),
  ('465','South Bend, IN'),('466','South Bend, IN'),
  ('467','Fort Wayne, IN'),('468','Fort Wayne, IN'),
  ('476','Evansville, IN'),('477','Evansville, IN'),('424','Evansville, IN'),
  ('400','Louisville, KY'),('401','Louisville, KY'),('402','Louisville, KY'),('471','Louisville, KY'),
  ('403','Lexington, KY'),('404','Lexington, KY'),('405','Lexington, KY'),
  ('480','Detroit, MI'),('481','Detroit, MI'),('482','Detroit, MI'),('483','Detroit, MI'),
  ('493','Grand Rapids, MI'),('494','Grand Rapids, MI'),('495','Grand Rapids, MI'),('496','Grand Rapids, MI'),
  ('600','Chicago, IL'),('601','Chicago, IL'),('602','Chicago, IL'),('603','Chicago, IL'),('604','Chicago, IL'),
  ('605','Chicago, IL'),('606','Chicago, IL'),('607','Chicago, IL'),('608','Chicago, IL'),
  ('463','Chicago, IL'),('464','Chicago, IL'),
  ('610','Rockford, IL'),('611','Rockford, IL'),
  ('615','Peoria, IL'),('616','Peoria, IL'),
  ('618','Champaign, IL'),
  ('530','Milwaukee, WI'),('531','Milwaukee, WI'),('532','Milwaukee, WI'),('534','Milwaukee, WI'),
  ('550','Minneapolis, MN'),('551','Minneapolis, MN'),('553','Minneapolis, MN'),('554','Minneapolis, MN'),
  ('555','Minneapolis, MN'),
  ('565','Fargo, ND'),('580','Fargo, ND'),('581','Fargo, ND'),
  ('585','Bismarck, ND'),
  ('570','Sioux Falls, SD'),('571','Sioux Falls, SD'),
  ('577','Rapid City, SD'),
  ('500','Des Moines, IA'),('501','Des Moines, IA'),('502','Des Moines, IA'),('503','Des Moines, IA'),
  ('522','Cedar Rapids, IA'),('524','Cedar Rapids, IA'),
  ('515','Omaha, NE'),('680','Omaha, NE'),('681','Omaha, NE'),
  ('683','Lincoln, NE'),('684','Lincoln, NE'),('685','Lincoln, NE'),
  ('630','St. Louis, MO'),('631','St. Louis, MO'),('633','St. Louis, MO'),
  ('620','St. Louis, MO'),('622','St. Louis, MO'),
  ('640','Kansas City, MO'),('641','Kansas City, MO'),('660','Kansas City, MO'),('661','Kansas City, MO'),
  ('662','Kansas City, MO'),
  ('664','Topeka, KS'),('665','Topeka, KS'),('666','Topeka, KS'),
  ('670','Wichita, KS'),('671','Wichita, KS'),('672','Wichita, KS'),
  ('648','Joplin, MO'),
  ('656','Springfield, MO'),('657','Springfield, MO'),('658','Springfield, MO'),
  -- South Central
  ('700','New Orleans, LA'),('701','New Orleans, LA'),
  ('707','Baton Rouge, LA'),('708','Baton Rouge, LA'),
  ('710','Shreveport, LA'),('711','Shreveport, LA'),
  ('713','Alexandria, LA'),('714','Alexandria, LA'),
  ('718','Texarkana, TX'),('755','Texarkana, TX'),
  ('720','Little Rock, AR'),('721','Little Rock, AR'),('722','Little Rock, AR'),
  ('727','Fayetteville, AR'),
  ('730','Oklahoma City, OK'),('731','Oklahoma City, OK'),
  ('740','Tulsa, OK'),('741','Tulsa, OK'),
  ('750','Dallas-Fort Worth, TX'),('751','Dallas-Fort Worth, TX'),('752','Dallas-Fort Worth, TX'),
  ('753','Dallas-Fort Worth, TX'),('760','Dallas-Fort Worth, TX'),('761','Dallas-Fort Worth, TX'),
  ('762','Dallas-Fort Worth, TX'),
  ('770','Houston, TX'),('771','Houston, TX'),('772','Houston, TX'),('773','Houston, TX'),
  ('774','Houston, TX'),('775','Houston, TX'),
  ('780','San Antonio, TX'),('781','San Antonio, TX'),('782','San Antonio, TX'),
  ('783','Corpus Christi, TX'),('784','Corpus Christi, TX'),
  ('785','McAllen, TX'),
  ('786','Austin, TX'),('787','Austin, TX'),
  ('790','Amarillo, TX'),('791','Amarillo, TX'),
  ('793','Lubbock, TX'),('794','Lubbock, TX'),
  ('798','El Paso, TX'),('799','El Paso, TX'),('880','El Paso, TX'),
  -- Mountain / Southwest
  ('800','Denver, CO'),('801','Denver, CO'),('802','Denver, CO'),('803','Denver, CO'),
  ('808','Colorado Springs, CO'),('809','Colorado Springs, CO'),
  ('810','Pueblo, CO'),
  ('815','Grand Junction, CO'),
  ('826','Casper, WY'),
  ('870','Albuquerque, NM'),('871','Albuquerque, NM'),
  ('875','Santa Fe, NM'),
  ('850','Phoenix, AZ'),('852','Phoenix, AZ'),('853','Phoenix, AZ'),
  ('856','Tucson, AZ'),('857','Tucson, AZ'),
  ('860','Flagstaff, AZ'),
  ('889','Las Vegas, NV'),('890','Las Vegas, NV'),('891','Las Vegas, NV'),
  ('894','Reno, NV'),('895','Reno, NV'),('897','Reno, NV'),
  ('840','Salt Lake City, UT'),('841','Salt Lake City, UT'),
  ('843','Ogden, UT'),('844','Ogden, UT'),
  ('846','Provo, UT'),('847','Provo, UT'),
  ('832','Pocatello, ID'),('834','Idaho Falls, ID'),
  ('836','Boise, ID'),('837','Boise, ID'),
  ('591','Billings, MT'),('594','Great Falls, MT'),('598','Missoula, MT'),
  -- Pacific
  ('980','Seattle, WA'),('981','Seattle, WA'),('982','Seattle, WA'),('983','Seattle, WA'),('984','Seattle, WA'),
  ('985','Seattle, WA'),
  ('989','Yakima, WA'),
  ('990','Spokane, WA'),('991','Spokane, WA'),('992','Spokane, WA'),('838','Spokane, WA'),
  ('993','Tri-Cities, WA'),
  ('970','Portland, OR'),('971','Portland, OR'),('972','Portland, OR'),('986','Portland, OR'),
  ('974','Eugene, OR'),('975','Medford, OR'),('977','Bend, OR'),
  ('900','Los Angeles, CA'),('901','Los Angeles, CA'),('902','Los Angeles, CA'),('903','Los Angeles, CA'),
  ('904','Los Angeles, CA'),('905','Los Angeles, CA'),('906','Los Angeles, CA'),('907','Los Angeles, CA'),
  ('908','Los Angeles, CA'),('910','Los Angeles, CA'),('911','Los Angeles, CA'),('912','Los Angeles, CA'),
  ('913','Los Angeles, CA'),('914','Los Angeles, CA'),('915','Los Angeles, CA'),('917','Los Angeles, CA'),
  ('918','Los Angeles, CA'),
  ('919','San Diego, CA'),('920','San Diego, CA'),('921','San Diego, CA'),
  ('922','Palm Springs, CA'),
  ('923','Inland Empire, CA'),('924','Inland Empire, CA'),('925','Inland Empire, CA'),
  ('931','Santa Maria, CA'),('934','San Luis Obispo, CA'),
  ('932','Fresno, CA'),('936','Fresno, CA'),('937','Fresno, CA'),('938','Fresno, CA'),
  ('933','Bakersfield, CA'),('935','Bakersfield, CA'),
  ('939','Salinas, CA'),
  ('940','Oakland, CA'),('941','Oakland, CA'),('943','Oakland, CA'),('944','Oakland, CA'),
  ('945','Oakland, CA'),('946','Oakland, CA'),('947','Oakland, CA'),('948','Oakland, CA'),
  ('949','Oakland, CA'),('950','Oakland, CA'),('951','Oakland, CA'),
  ('952','Stockton, CA'),('953','Stockton, CA'),
  ('954','Santa Rosa, CA'),
  ('956','Sacramento, CA'),('957','Sacramento, CA'),('958','Sacramento, CA'),('959','Sacramento, CA'),
  ('960','Redding, CA')
) as z(zip3, metro_name)
join public.metros m on m.name = z.metro_name
on conflict do nothing;

-- Carve-outs: a zip5 row beats the zip3 row above, which is how these three
-- metros get their real ZIPs back from the neighbour that owns the prefix.
insert into public.metro_zip_map (zip5, metro_id)
select z.zip5, m.id
from (values
  -- Laredo sits inside San Antonio's 780 prefix.
  ('78040','Laredo, TX'),('78041','Laredo, TX'),('78042','Laredo, TX'),('78043','Laredo, TX'),
  ('78044','Laredo, TX'),('78045','Laredo, TX'),('78046','Laredo, TX'),
  -- Yuma sits inside Phoenix's 853 prefix.
  ('85364','Yuma, AZ'),('85365','Yuma, AZ'),('85366','Yuma, AZ'),('85367','Yuma, AZ'),('85369','Yuma, AZ'),
  -- Santa Maria sits inside San Luis Obispo's 934 prefix.
  ('93454','Santa Maria, CA'),('93455','Santa Maria, CA'),('93456','Santa Maria, CA'),
  ('93457','Santa Maria, CA'),('93458','Santa Maria, CA')
) as z(zip5, metro_name)
join public.metros m on m.name = z.metro_name
on conflict do nothing;
