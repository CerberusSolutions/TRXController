#!/bin/sh
# Serial ports (/dev/ttyUSB*, /dev/ttyACM*) belong to the dialout group on Debian and Ubuntu.
# Tell the person installing how to get access; the package must not change group membership itself.
echo "TRXController: to open the scanner's serial port, add your user to the dialout group and log in again:"
echo "    sudo usermod -aG dialout \$USER"
exit 0
