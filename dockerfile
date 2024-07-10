# Use the official Ubuntu base image
FROM ubuntu:20.04

# Set environment variables to non-interactive
ENV DEBIAN_FRONTEND=noninteractive

# Install required packages and create user azuser
RUN apt-get update && apt-get install -y \
    sudo \
    curl \
    gnupg2 \
    openssh-server \
    vim \
    nano \
    cron \
    apt-utils \
    python3 \
    python3-pip 

RUN useradd -m -s /bin/bash azuser && echo "azuser:azuserpassword" | chpasswd && adduser azuser sudo \
    && echo "azuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && mkdir /var/run/sshd

# Install Node.js (using NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_21.x | sudo -E bash - && \
    sudo apt-get install -y nodejs

# Install 1Password CLI
RUN sudo -s \
    && curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
    gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" | \
    tee /etc/apt/sources.list.d/1password.list \
    && mkdir -p /etc/debsig/policies/AC2D62742012EA22/ \
    && curl -sS https://downloads.1password.com/linux/debian/debsig/1password.pol | \
    tee /etc/debsig/policies/AC2D62742012EA22/1password.pol \
    && mkdir -p /usr/share/debsig/keyrings/AC2D62742012EA22 \
    && curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
    gpg --dearmor --output /usr/share/debsig/keyrings/AC2D62742012EA22/debsig.gpg \
    && apt update && apt install -y 1password-cli

# Install Google Chrome
RUN sudo apt install curl gnupg -y && \
    curl --location --silent https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add - && \
    sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    sudo apt update && sudo apt install -y google-chrome-stable --no-install-recommends && \
    sudo rm -rf /var/lib/apt/lists/*

# install the http server global
RUN npm install -g http-server

# Switch to user azuser
USER azuser
WORKDIR /home/azuser


# Copy the Node.js script and install necessary npm packages
COPY --chown=azuser:azuser . .
RUN npm install puppeteer dotenv axios ws


# Make a directory for the HTTP server
RUN mkdir -p /home/azuser/http

# Set the environment variable for the HTTP server
ENV HTTP_DIR=/home/azuser/http



# Set up cron job - The -l is needed for the 1password credentials
RUN (crontab -l 2>/dev/null; echo "*/5 * * * * bash -l /home/azuser/scrape.sh ") | crontab -


# Switch back to root user to configure SSH
USER root

# Configure SSH

RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Create a script to serve the file
RUN echo "http-server /home/azuser/http -p 80 -a 0.0.0.0" > /home/azuser/start_server.sh && chmod +x /home/azuser/start_server.sh


# Create readme.txt
RUN echo "need to run op signin to create the connection make sure op can list the vaults" > /home/azuser/readme.txt

# Expose ports
EXPOSE 2223 8180

# Start SSH and cron service, then start the Python server
CMD sudo service ssh start && cron && /home/azuser/start_server.sh
