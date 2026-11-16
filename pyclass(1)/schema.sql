create table users(id integer primary key,username text unique,name text,role text,section text default '',salt text,hash text);
create table sessions(token text primary key,user_id integer,exp integer);
create table assignments(id integer primary key,title text,kind text,unit integer,due text,section text default '',prompt text,questions text,created integer);
create table submissions(id integer primary key,assignment_id integer,user_id integer,answers text,score real,feedback text,submitted_at integer,unique(assignment_id,user_id));
