# Put your interface name here
INTERFACE=ens4

if tc qdisc show dev $INTERFACE | grep netem; then
    sudo tc qdisc del dev $INTERFACE root
else
    echo "no netem rule"
fi
