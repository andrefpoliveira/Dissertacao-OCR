import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';

import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';

import SwapVertIcon from '@mui/icons-material/SwapVert';

import { v4 as uuidv4 } from 'uuid';

import loadComponent from '../../../utils/loadComponents';

const UPDATE_TIME = 15;
const STUCK_UPDATE_TIME = 10 * 60; // 10 Minutes 
const validExtensions = [".pdf"];

const chunkSize = 1024 * 1024 * 3; // 3 MB

class FileExplorer extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            app: props.app,
            files: props.files,
            info: {},
            current_folder: props.current_folder.split('/'),
            buttonsDisabled: props.current_folder.split('/').length === 1,
            components: [],

            updatingRows: [],
            updatingRate: 15,
            updateCount: 0,

            loading: false,

            layoutMenu: false,
            layoutFilename: null,

            editingMenu: false,
            editingFilename: null,

            downloadLoading: false,
        }

        this.folderMenu = React.createRef();
        this.ocrMenu = React.createRef();
        this.deleteMenu = React.createRef();
        this.storageMenu = React.createRef();

        this.successNot = React.createRef();
        this.errorNot = React.createRef();

        this.interval = null;
        this.rowRefs = [];
    }

    componentDidMount() {
        /**
         * Fetch the files and info from the server
         */
        fetch(process.env.REACT_APP_API_URL + 'files', {
            method: 'GET'
        })
        .then(response => {return response.json()})
        .then(data => {
            var info = data["info"];
            var files = {'files': data["files"]};
            
            this.setState({files: files, info: info, loading: false}, this.displayFileSystem);
        });

        // Update the info every UPDATE_TIME seconds
        this.createUpdateInfo();

        // Check for stuck uploads every STUCK_UPDATE_TIME seconds
        this.interval = setInterval(() => {
            fetch(process.env.REACT_APP_API_URL + 'info?path=' + this.state.current_folder.join("/"), {
                method: 'GET'
            })
            .then(response => {return response.json()})
            .then(data => {
                var info = data["info"];
                // Find if a upload is stuck
                for (const [path, value] of Object.entries(info)) {
                    if (value.type === "file") {
                        if ("progress" in value && value["progress"] !== true) {
                            const creationTime = new Date(value.creation.replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/, '$3-$2-$1T$4:$5:$6'));
                            const currentTime = new Date();
                            const timeDiffMinutes = (currentTime - creationTime) / (1000 * 60);
                        
                            if (timeDiffMinutes >= 10) {
                                fetch(process.env.REACT_APP_API_URL + 'set-upload-stuck', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({
                                        "path": path,
                                    }),
                                })
                                .then(response => response.json());                                
                            }
                        }
                    }
                }

                this.setState({info: info, updateCount: 0}, this.updateInfo);
            });
        }, 1000 * STUCK_UPDATE_TIME);
    }

    createUpdateInfo() {
        this.interval = setInterval(() => {
            fetch(process.env.REACT_APP_API_URL + 'info?path=' + this.state.current_folder.join("/"), {
                method: 'GET'
            })
            .then(response => {return response.json()})
            .then(data => {
                var info = data["info"];

                this.setState({info: info, updateCount: 0}, this.updateInfo);
            });
        }, 1000 * UPDATE_TIME);
    }

    updateInfo() {
        if (this.state.layoutMenu || this.state.editingMenu) return;
        this.rowRefs.forEach(ref => {
            var filename = this.state.current_folder.join("/") + "/" + ref.current.state.name;
            if (this.state.updatingRows.length === 0 || this.state.updatingRows.includes(filename)) {
                var rowInfo = this.getInfo(filename);
                ref.current.updateInfo(rowInfo);
            }
        });
        this.setState({updateCount: 0, updatingRows: []});
    }

    componentWillUnmount() {
        if (this.interval)
            clearInterval(this.interval);
    }

    updateFiles(data) {
        /**
         * Update the files and info
         */

        var files = {'files': data['files']}
        var info = data['info'];

        this.setState({ files: files, info: info }, this.displayFileSystem);
    }

    createFolder() {
        /**
         * Open the folder menu
         */
        this.folderMenu.current.currentPath(this.state.current_folder.join('/'));
        this.folderMenu.current.toggleOpen();
    }

    showStorageForm(errorMessage) {
        this.storageMenu.current.setMessage(errorMessage);
        this.storageMenu.current.toggleOpen();
    }

    performOCR(multiple, file=null) {
        var path = this.state.current_folder.join('/');
        if (file !== null) path += '/' + file;
        this.ocrMenu.current.currentPath(path);
        this.ocrMenu.current.setMultiple(multiple);
        this.ocrMenu.current.performOCR("Tesseract", ["por"], path, multiple);

        // Right now, we dont want to show the menu. Assume default settings
        // this.ocrMenu.current.toggleOpen();
    }

    sendChunk(i, chunk, fileName, _totalCount, _fileID) {
        var formData = new FormData();
        formData.append('file', chunk);
        formData.append('path', this.state.current_folder.join('/'))
        formData.append('name', fileName);
        formData.append("fileID", _fileID);
        formData.append('counter', i+1);
        formData.append('totalCount', _totalCount);

        fetch(process.env.REACT_APP_API_URL + 'upload-file', {
            method: 'POST',
            body: formData
        }).then(response => {return response.json()})
        .then(data => {
            if (data['success']) {
                var info = this.state.info;

                for (var k in data["info"]) {
                    info[k] = data["info"][k];
                }

                var updatingList = this.state.updatingRows;
                var complete_filename = this.state.current_folder.join("/") + "/" + fileName;
                if (!updatingList.includes(complete_filename)) {
                    updatingList.push(complete_filename);
                }

                if (data["finished"] || this.state.updateCount === this.state.updatingRate) {
                    this.setState({info: info, updateCount: 0, updatingRows: updatingList}, this.updateInfo);
                } else {
                    this.setState({updateCount: this.state.updateCount + 1});
                }
            } else {
                this.storageMenu.current.setMessage(data.error);
                this.storageMenu.current.toggleOpen();
            }
        })
        .catch(error => {
            this.sendChunk(i, chunk, fileName, _totalCount, _fileID);
        });
    }

    createFile() {
        /**
         * This is a hack to get around the fact that the input type="file" element
         * cannot be accessed from the React code. This is because the element is
         * not rendered by React, but by the browser itself.
         *
         * Function to select the files to be submitted
         */

        var el = window._protected_reference = document.createElement("INPUT");
        el.type = "file";
        el.accept = validExtensions.join(',');
        el.multiple = true;

        el.addEventListener('change', () => {
            if (el.files.length === 0) return;

            // Sort files by size (ascending)
            var files = Array.from(el.files).sort((a, b) => a.size - b.size);

            for (let i = 0; i < files.length; i++) {
                let fileBlob = files[i];
                let fileSize = files[i].size;
                let fileName = files[i].name;
                let fileType = files[i].type;

                const _totalCount = fileSize % chunkSize === 0
                ? fileSize / chunkSize
                : Math.floor(fileSize / chunkSize) + 1;

                const _fileID = uuidv4() + "." + fileName.split('.').pop();

                fetch(process.env.REACT_APP_API_URL + 'prepare-upload', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        path: this.state.current_folder.join('/'),
                        name: fileName,
                    })
                }).then(response => {return response.json()})
                .then(data => {
                    if (data['success']) {
                        var filesystem = data["filesystem"];
                        var info = filesystem["info"];
                        var files = {'files': filesystem["files"]};
                        this.setState({files: files, info: info}, this.displayFileSystem);
                        fileName = data["filename"];

                        // Send chunks
                        var startChunk = 0;
                        var endChunk = chunkSize;
        
                        for (let i = 0; i < _totalCount; i++) {
                            var chunk = fileBlob.slice(startChunk, endChunk, fileType);
                            startChunk = endChunk;
                            endChunk = endChunk + chunkSize;
        
                            this.sendChunk(i, chunk, fileName, _totalCount, _fileID);
                        }
                    } else {
                        this.storageMenu.current.setMessage(data.error);
                        this.storageMenu.current.toggleOpen();
                    }
                });

            }
        });
        el.click();
    }

    createPrivateSession() {
        fetch(process.env.REACT_APP_API_URL + 'create-private-session', {
            method: 'GET'
        })
        .then(response => {return response.json()})
        .then(data => {
            var sessionId = data["sessionId"];
            if (window.location.href.endsWith('/')) {
                window.location.href = window.location.href + `${sessionId}`;
            } else {
                window.location.href = window.location.href + `/${sessionId}`;
            }
        });
    }

    goBack() {
        /**
         * Go back to the previous folder
         */
        var current_folder = this.state.current_folder;
        current_folder.pop();
        var buttonsDisabled = current_folder.length === 1;
        var createFileButtonDisabled = current_folder.length === 1;
        this.state.app.setState({path: current_folder.join('/')});
        this.setState({
            current_folder: current_folder,
            buttonsDisabled: buttonsDisabled,
            createFileButtonDisabled: createFileButtonDisabled
        },
        this.displayFileSystem);
    }

    getDocument(type, file, suffix="") {
        /**
         * Export the .txt or .pdf file
         */
        var path = this.state.current_folder.join('/') + '/' + file;

        fetch(process.env.REACT_APP_API_URL + "get_" + type + '?path=' + path, {
            method: 'GET'
        })
        .then(response => {return response.blob()})
        .then(data => {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(data);

            var basename = file.split('.').slice(0, -1).join('.');
            a.download = basename + '_ocr' + suffix + '.' + type.split('_')[0];
            a.click();
            a.remove();
        });
    }

    getEntities(file) {
        var path = this.state.current_folder.join('/') + '/' + file;
        fetch(process.env.REACT_APP_API_URL + "get_entities?path=" + path, {
            method: 'GET'
        })
        .then(response => {return response.blob()})
        .then(data => {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(data);

            var basename = file.split('.').slice(0, -1).join('.');
            a.download = basename + '_entidades.json';
            a.click();
            a.remove();
        });
    }

    requestEntities(file) {
        var path = this.state.current_folder.join('/') + '/' + file;
        fetch(process.env.REACT_APP_API_URL + "request_entities?path=" + path, {
            method: 'GET'
        })
        .then(response => {return response.json()})
        .then(data => {
            if (data.success) {
                var filesystem = data["filesystem"];
                var info = filesystem["info"];
                var files = {'files': filesystem["files"]};

                this.setState({files: files, info: info}, this.displayFileSystem);
            }
        });
    }

    getZip() {
        /**
         * Export the .zip file
         */
        this.setState({downloadLoading: true});
        var path = this.state.current_folder.join('/');

        fetch(process.env.REACT_APP_API_URL + "get_zip?path=" + path, {
            method: 'GET'
        })
        .then(response => {
            this.setState({downloadLoading: false});
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.indexOf("application/json") !== -1) {
                return response.json();
            }

            this.successNot.current.setMessage("O seu download vai começar em breves momentos.")
            this.successNot.current.open();
            return response.blob()
        })
        .then(data => {
            // Check if data is a blob
            if (data instanceof Blob) {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(data);
    
                a.download = path.split('/').slice(-1)[0] + '.zip';
                a.click();
                a.remove();
            } else {
                this.errorNot.current.setMessage(data.message)
                this.errorNot.current.open();
            }
        });
    }



    getOriginalFile(file) {
        var path = this.state.current_folder.join('/') + '/' + file;

        fetch(process.env.REACT_APP_API_URL + "get_original?path=" + path, {
            method: 'GET'
        })
        .then(response => {return response.blob()})
        .then(data => {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(data);

            a.download = file;
            a.click();
            a.remove();
        });
    }

    getDelimiterTxt(file) {
        /**
         * Export the .txt file
         * with the delimiter
         */
        this.getDocument("txt_delimitado", file, "_delimitado");
    }

    getTxt(file) {
        /**
         * Export the .txt file
         */
        this.getDocument("txt", file);
    }

    getCSV(file) {
        /**
         * Export the .csv file
         */
         this.getDocument("csv", file);
    }

    getImages(file) {
        /**
         * Export the .zip file
         */
        var path = this.state.current_folder.join('/') + '/' + file;

        fetch(process.env.REACT_APP_API_URL + "get_images?path=" + path, {
            method: 'GET'
        })
        .then(response => {return response.blob()})
        .then(data => {
            var a = document.createElement('a');
                a.href = URL.createObjectURL(data);
    
                a.download = path.split('/').slice(-1)[0] + '.zip';
                a.click();
                a.remove();
        });
    }

    getPdf(file) {
        /**
         * Export the .pdf file
         */
        this.getDocument("pdf", file, "_texto_indice");
    }

    getPdfSimples(file) {
        /**
         * Export the .pdf file
         */
        this.getDocument("pdf_simples", file, "_texto");
    }

    editFile(file) {
        /**
         * Open the file in the editor
         */
        var path = this.state.current_folder.join('/');
        var filename = path + '/' + file;
        this.state.app.editFile(path, filename);
    }

    viewFile(file, algorithm, config) {
        var path = this.state.current_folder.slice(1).join('/');
        file = file.split('/')[0];
        var filename = path + '/' + file;
        this.state.app.viewFile(filename, algorithm, config);
    }

    deleteItem(name) {
        /**
         * Open the delete menu
         */
        this.deleteMenu.current.currentPath(this.state.current_folder.join('/') + '/' + name);
        this.deleteMenu.current.toggleOpen();
    }

    enterFolder(folder) {
        /**
         * Enter the folder and update the path
         */
        var current_folder = this.state.current_folder;
        current_folder.push(folder);
        this.state.app.setState({
            path: current_folder.join('/'),
            currentFolder: current_folder
        });
        this.setState({
            current_folder: current_folder,
            buttonsDisabled: false,
            createFileButtonDisabled: false},
        this.displayFileSystem);
    }

    findFolder(files, folder) {
        /**
         * Find the folder in the files
         */
        if ( Array.isArray(files) ) {
            var i;
            for (i = 0; i < files.length; i++) {
                var dict = files[i];
                const key = Object.keys(dict)[0];
                if (key === folder) {
                    return dict[folder];
                }
            }
        }
        return files[folder];
    }

    getPathContents() {
        /**
         * Get the contents of the current folder
         */
        var files = this.state.files;
        var current_folder = this.state.current_folder;

        for (let f in current_folder) {
            var key = current_folder[f];
            files = this.findFolder(files, key);
        }

        return files;
    }

    getInfo(path) {
        /**
         * Get the info of the file
         */
        return this.state.info[path];
    }

    sortContents(contents) {
        /**
         * Sorts the contents of the current folder
         * First order by type (folder, file)
         * Then order by name
         */
        var folders = [];
        var files = [];

        for (let f in contents) {
            var item = contents[f];
            if (typeof item === 'string' || item instanceof String) {
                files.push(item);
            } else {
                folders.push(item);
            }
        }

        folders.sort(function(d1, d2) {
            var key1 = Object.keys(d1)[0];
            var key2 = Object.keys(d2)[0];
            return key1.localeCompare(key2);
        });
        files.sort();

        return folders.concat(files);
    }

    sortByName(contents) {
        /**
         * Order 'Nome' column
         * by A-Z or Z-A when
         * the  column is clicked
         */

        const isSorted = (a) => {
            let sorted = true;
            if (a.length > 1) {
                if (a[0].key.localeCompare(a[1].key) === 1){
                    sorted = false;
                }
            }
            return sorted;
        }

        if (isSorted(contents)) {
            this.setState({components: contents.sort((a, b) => (b.key).localeCompare(a.key))}, this.updateInfo);
        } else {
            this.setState({components: contents.sort((a, b) => (a.key).localeCompare(b.key))}, this.updateInfo);
        }
    }

    displayFileSystem() {
        /**
         * Iterate the contents of the folder and build the components
         */
        const FileRow = loadComponent('FileSystem', 'FileRow');
        const FolderRow = loadComponent('FileSystem', 'FolderRow');

        var contents = this.sortContents(this.getPathContents());
        this.rowRefs = [];

        var items = [];

        for (let f in contents) {
            var ref = React.createRef();
            this.rowRefs.push(ref);

            var item = contents[f];
            if (typeof item === 'string' || item instanceof String) {
                items.push(
                    <FileRow
                        ref={ref}
                        key={item}
                        name={item}
                        info={this.getInfo(this.state.current_folder.join("/") + "/" + item)}
                        filesystem={this}
                    />
                )
            } else {
                var key = Object.keys(item)[0];
                items.push(
                    <FolderRow
                        ref={ref}
                        key={key}
                        name={key}
                        info={this.getInfo(this.state.current_folder.join("/") + "/" + key)}
                        filesystem={this}
                        current_folder={this.state.current_folder}
                    />
                )
            }
        }
        this.setState({components: items}, this.updateInfo);
    }

    createLayout(filename) {
        this.state.app.setState({layoutMenu: true});
        this.setState({layoutMenu: true, layoutFilename: filename});
    }

    closeLayoutMenu() {
        this.state.app.setState({layoutMenu: false});
        this.setState({layoutMenu: false, layoutFilename: null});
    }

    editText(filename) {
        this.state.app.setState({editingMenu: true});
        this.setState({editingMenu: true, editingFilename: filename});
    }

    closeEditingMenu() {
        this.state.app.setState({editingMenu: false});
        this.setState({editingMenu: false, editingFilename: null});
    }

    generateTable() {
        return (
            <TableContainer component={Paper}>
                <Table aria-label="filesystem table" sx={{border:"1px solid #aaa"}}>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{borderLeft:"1px solid #aaa"}}>
                                <Button
                                    startIcon={<SwapVertIcon />}
                                    sx={{backgroundColor: '#ffffff', color: '#000000', ':hover': {bgcolor: '#dddddd'}, textTransform: 'none'}}
                                    onClick={() => this.sortByName(this.state.components)}>
                                    <b>Nome</b>
                                </Button>
                            </TableCell>
                            <TableCell align='center' sx={{borderLeft:"1px solid #aaa"}}><b>Data de criação</b></TableCell>
                            <TableCell align='center' sx={{borderLeft:"1px solid #aaa"}}><b>Descrição</b></TableCell>
                            <TableCell align='center' sx={{borderLeft:"1px solid #aaa"}}><b>Tamanho</b></TableCell>
                            <TableCell align='center' sx={{borderLeft:"1px solid #aaa"}}><b>Ações</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {this.state.components}
                    </TableBody>
                </Table>
            </TableContainer>
        )
    }

    indexFile(file, multiple) {
        var path = this.state.current_folder.join('/') + '/' + file;

        fetch(process.env.REACT_APP_API_URL + 'index-doc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                "path": path,
                "multiple": multiple
            }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.successNot.current.setMessage(data.message)
                this.successNot.current.open();
            } else {
                this.errorNot.current.open();
            }

            this.updateFiles(data.files);
        })
    }

    removeIndexFile(file, multiple) {
        var path = this.state.current_folder.join('/') + '/' + file;

        fetch(process.env.REACT_APP_API_URL + 'remove-index-doc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                "path": path,
                "multiple": multiple
            }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.successNot.current.setMessage(data.message)
                this.successNot.current.open();
            } else {
                this.errorNot.current.open();
            }

            this.updateFiles(data.files);
        })
    }

    checkOCRComplete() {
        let obj = this.state.info;

        for (let key in obj) {
            if (obj[key] && typeof obj[key] === 'object') {
                if (obj[key].ocr){
                    if ((obj[key].ocr.progress) !== obj[key].pages) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    changeFolderFromPath(folder_name) {
        var current_folder = this.state.current_folder;

        // Remove the last element of the path until we find folder_name
        while (current_folder[current_folder.length - 1] !== folder_name) {
            current_folder.pop();
        }

        var buttonsDisabled = current_folder.length === 1;
        var createFileButtonDisabled = current_folder.length === 1;

        this.setState({
            current_folder: current_folder,
            buttonsDisabled: buttonsDisabled,
            createFileButtonDisabled: createFileButtonDisabled,
        }, this.displayFileSystem);
    }

    generatePath() {
        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap'
            }}>
                {
                    this.state.current_folder.map((folder, index) => {
                        var name;
                        if (folder !== 'files') {
                            name = folder;
                        }
                        else {
                            name = 'Início';
                        }
                        return (
                            <Box sx={{display: "flex", flexDirection: "row"}} key={"Box" + folder}>
                                <Button 
                                    key={folder}
                                    onClick={() => this.changeFolderFromPath(folder)}
                                    style={{
                                        margin: 0,
                                        padding: '0px 15px 0px 15px',
                                        textTransform: 'none',
                                        display: "flex",
                                        textAlign: "left",
                                        textDecoration: "underline",
                                    }}
                                    variant="text"
                                >
                                    {name}
                                </Button>
                                <p key={index}>/</p>
                            </Box>
                        )
                    })
                }
            </Box>
        )
    }

    render() {
        const Notification = loadComponent('Notification', 'Notifications');
        const FolderMenu = loadComponent('Form', 'FolderMenu');
        const OcrMenu = loadComponent('Form', 'OcrMenu');
        const DeleteMenu = loadComponent('Form', 'DeleteMenu');
        const LayoutMenu = loadComponent('LayoutMenu', 'LayoutMenu');
        const EditingMenu = loadComponent('EditingMenu', 'EditingMenu');
        const FullStorageMenu = loadComponent('Form', 'FullStorageMenu');

        return (
            <>
                {
                    this.state.layoutMenu
                    ? <LayoutMenu filesystem={this} filename={this.state.layoutFilename} />
                    : this.state.editingMenu
                        ? <EditingMenu filesystem={this} filename={this.state.editingFilename} />
                        : <Box sx={{
                            ml: '1.5rem',
                            mr: '1.5rem',
                            mb: '1.5rem',
                        }}>
                            <Notification message={""} severity={"success"} ref={this.successNot}/>
                            <Notification message={""} severity={"error"} ref={this.errorNot}/>

                            <FolderMenu filesystem={this} ref={this.folderMenu}/>
                            <OcrMenu filesystem={this} ref={this.ocrMenu}/>
                            <DeleteMenu filesystem={this} ref={this.deleteMenu} />
                            <FullStorageMenu filesystem={this} ref={this.storageMenu} />

                            {
                                this.generateTable()
                            }
                        </Box>
                }
            </>
        );
    }
}

export default FileExplorer;
