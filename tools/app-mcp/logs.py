import json, sys, urllib.request
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 80
req = urllib.request.Request("http://127.0.0.1:47322/cmd", data=json.dumps({"cmd": "logs", "args": {"limit": limit}}).encode(), method="POST")
for line in json.loads(urllib.request.urlopen(req).read())["result"].split("\n"):
    if len(sys.argv) > 2 and any(x in line for x in sys.argv[2].split(",")): continue
    print(line)
