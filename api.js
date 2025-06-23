// Add a route to serve JFK document images
router.get('/jfk-media', (req, res) => {
    const { id, type } = req.query;
    
    if (!id || !type) {
        return res.status(400).send("Missing id or type parameter");
    }
    
    let filePath;
    if (type === 'pdf') {
        filePath = path.join(mediaDirectory, 'jfk', 'pdf', id);
    } else if (type === 'image') {
        filePath = path.join(mediaDirectory, 'jfk', 'images', id);
    } else if (type === 'analysis') {
        filePath = path.join(mediaDirectory, 'jfk', 'analysis', id);
    } else {
        return res.status(400).send("Invalid type parameter");
    }
    
    console.log('Serving JFK file:', filePath);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("File not found");
    }
}); 